import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { Prisma } from "@/generated/prisma/client";
import { environment } from "@/configuration/environment";
import type { AppEnvironment } from "@/configuration/environment/types";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { newUuid, type Uuid } from "@/configuration/validation/uuid";
import ConflictError from "@/errors/http/conflict.error";
import PasskeyRegistrationFailedError from "@/errors/http/passkey-registration-failed.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { SecurityNotificationService } from "@/features/auth/security-notification/security-notification.service";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { PasskeyChallengeStore } from "./passkey-challenge.store";
import {
  MAX_PASSKEYS_PER_USER,
  PASSKEY_CHALLENGE_TTL_SECONDS,
  toPasskeyDeviceType,
  toPasskeyTransports,
  type PasskeyListResult,
  type PasskeyRegistrationCredential,
  type PasskeyRegistrationOptionsResult,
  type PasskeyRegistrationResult,
  type PasskeySummary,
} from "./passkey.model";
import type {
  PasskeyRepository,
  UserWebAuthnCredential,
} from "./passkey.repository";

type WebAuthnConfig = AppEnvironment["webauthn"];

interface PasskeyServiceOptions {
  passkeyRepository: PasskeyRepository;
  passkeyChallengeStore: PasskeyChallengeStore;
  usersRepository: Pick<UsersRepository, "findUserById">;
  authAuditService: AuthAuditService;
  securityNotificationService: SecurityNotificationService;
  /** Defaults to the `webauthn` config, read on each request. */
  getConfig?: () => WebAuthnConfig;
}

/** The session a passkey is being managed from. */
export interface PasskeyActor {
  userId: Uuid;
  sessionId: string;
  context?: AuthAuditContext;
}

/**
 * Passkeys as a second factor: registering one, listing, renaming and
 * removing them. Every route that reaches this service is behind step-up.
 *
 * Only the public key, counter and some metadata are stored. The WebAuthn
 * checks themselves (challenge, origin, RP ID, signature) are done by
 * `@simplewebauthn/server`; what is decided here is which challenge an answer
 * must match and what a passkey may be used for.
 */
export class PasskeyService {
  private readonly logger: Logger;
  private readonly getConfig: () => WebAuthnConfig;

  constructor(private readonly options: PasskeyServiceOptions) {
    this.logger = loggerFactory.forClass(PasskeyService, "service");
    this.getConfig =
      options.getConfig ?? (() => environment.getWebAuthnConfig());
  }

  /**
   * Starts a registration. The challenge is bound to the session, so only the
   * session that asked can finish, and a second request replaces the first.
   */
  async beginRegistration(
    actor: PasskeyActor,
  ): Promise<PasskeyRegistrationOptionsResult> {
    const user = await this.options.usersRepository.findUserById(actor.userId);

    if (!user) {
      throw new UnauthorizedError("Session is no longer valid.");
    }

    const existing = await this.options.passkeyRepository.listByUserId(
      actor.userId,
    );

    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      throw this.limitReachedError();
    }

    const config = this.getConfig();
    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.profile.username;
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      // The account id, not anything personal: authenticators may show or
      // sync the user handle, and #466 maps it back to the account.
      userID: new TextEncoder().encode(actor.userId),
      userName: user.profile.username,
      userDisplayName: displayName,
      timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
      attestationType: "none",
      excludeCredentials: existing.map((row) => ({
        id: isoBase64URL.fromBuffer(row.credentialId),
        transports: toPasskeyTransports(readTransports(row)),
      })),
      // Discoverable when the authenticator can, so the same passkey can sign
      // in without a password once that lands (#466).
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    await this.options.passkeyChallengeStore.issue(
      "register",
      this.registrationBinding(actor),
      { challenge: options.challenge, userId: actor.userId },
    );

    return { options };
  }

  async finishRegistration(
    actor: PasskeyActor & {
      credential: PasskeyRegistrationCredential;
      name?: string;
    },
  ): Promise<PasskeyRegistrationResult> {
    const challenge = await this.options.passkeyChallengeStore.consume(
      "register",
      this.registrationBinding(actor),
    );

    if (!challenge || challenge.userId !== actor.userId) {
      throw new PasskeyRegistrationFailedError(
        "That passkey request has expired. Start adding the passkey again.",
      );
    }

    const config = this.getConfig();
    let verification: VerifiedRegistrationResponse;

    try {
      verification = await verifyRegistrationResponse({
        response: actor.credential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        // Preferred, not required: a security key without a PIN is still a
        // phishing-resistant second factor on top of the password.
        requireUserVerification: false,
      });
    } catch (error) {
      this.logger.warn("Passkey registration could not be verified.", {
        userId: actor.userId,
        sessionId: actor.sessionId,
        reason: error instanceof Error ? error.message : "unknown",
      });
      throw new PasskeyRegistrationFailedError();
    }

    if (!verification.verified) {
      throw new PasskeyRegistrationFailedError();
    }

    const info = verification.registrationInfo;
    const existingCount = await this.options.passkeyRepository.countByUserId(
      actor.userId,
    );
    let result: Awaited<ReturnType<PasskeyRepository["createWithinCap"]>>;

    try {
      result = await this.options.passkeyRepository.createWithinCap({
        id: newUuid(),
        userId: actor.userId,
        credentialId: isoBase64URL.toBuffer(info.credential.id),
        publicKey: Uint8Array.from(info.credential.publicKey),
        signCount: info.credential.counter,
        transports: toPasskeyTransports(
          info.credential.transports ?? actor.credential.response.transports,
        ),
        aaguid: info.aaguid,
        backedUp: info.credentialBackedUp,
        deviceType: toPasskeyDeviceType(info.credentialDeviceType),
        name: actor.name ?? `Passkey ${existingCount + 1}`,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("This passkey is already registered.");
      }
      throw error;
    }

    if (result.status === "limit_reached") {
      throw this.limitReachedError();
    }

    const passkey = toPasskeySummary(result.row);
    const eventId = newUuid();
    const emailNotification =
      await this.options.securityNotificationService.notify({
        kind: "passkey_added",
        details: { passkeyName: passkey.name },
        userId: actor.userId,
        eventId,
        context: actor.context,
      });

    await this.options.authAuditService.recordSafely({
      id: eventId,
      eventType: "mfa.passkey_added",
      outcome: "success",
      userId: actor.userId,
      sessionId: actor.sessionId,
      context: actor.context,
      metadata: {
        passkeyId: passkey.id,
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp,
        emailNotification,
      },
    });

    return { passkey };
  }

  async list(userId: Uuid): Promise<PasskeyListResult> {
    const rows = await this.options.passkeyRepository.listByUserId(userId);

    return { passkeys: rows.map(toPasskeySummary) };
  }

  /** A name is a label only, so renaming is audited but not emailed. */
  async rename(
    actor: PasskeyActor & { id: string; name: string },
  ): Promise<PasskeySummary> {
    const row = await this.options.passkeyRepository.rename(
      actor.userId,
      actor.id,
      actor.name,
    );

    if (!row) {
      throw new ResourceNotFoundError("Passkey not found.");
    }

    await this.options.authAuditService.recordSafely({
      eventType: "mfa.passkey_renamed",
      outcome: "success",
      userId: actor.userId,
      sessionId: actor.sessionId,
      context: actor.context,
      metadata: { passkeyId: row.id },
    });

    return toPasskeySummary(row);
  }

  async remove(actor: PasskeyActor & { id: string }): Promise<void> {
    const row = await this.options.passkeyRepository.deleteForUser(
      actor.userId,
      actor.id,
    );

    if (!row) {
      throw new ResourceNotFoundError("Passkey not found.");
    }

    const eventId = newUuid();
    const emailNotification =
      await this.options.securityNotificationService.notify({
        kind: "passkey_removed",
        details: { passkeyName: row.name },
        userId: actor.userId,
        eventId,
        context: actor.context,
      });

    await this.options.authAuditService.recordSafely({
      id: eventId,
      eventType: "mfa.passkey_removed",
      outcome: "success",
      userId: actor.userId,
      sessionId: actor.sessionId,
      context: actor.context,
      metadata: { passkeyId: row.id, emailNotification },
    });
  }

  private registrationBinding(actor: PasskeyActor): string {
    return `${actor.userId}:${actor.sessionId}`;
  }

  private limitReachedError(): ConflictError {
    return new ConflictError(
      `An account can hold at most ${MAX_PASSKEYS_PER_USER} passkeys. Remove one before adding another.`,
    );
  }
}

function readTransports(row: UserWebAuthnCredential): string[] {
  return Array.isArray(row.transports)
    ? row.transports.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

export function toPasskeySummary(row: UserWebAuthnCredential): PasskeySummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    backedUp: row.backedUp,
    deviceType: row.deviceType,
    transports: toPasskeyTransports(readTransports(row)),
  };
}
