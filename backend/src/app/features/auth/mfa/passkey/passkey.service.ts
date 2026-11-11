import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { Prisma } from "@/generated/prisma/client";
import { environment } from "@/configuration/environment";
import type { AppEnvironment } from "@/configuration/environment/types";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { newUuid, type Uuid } from "@/configuration/validation/uuid";
import ConflictError from "@/errors/http/conflict.error";
import MfaFactorUnavailableError from "@/errors/http/mfa-factor-unavailable.error";
import PasskeyRegistrationFailedError from "@/errors/http/passkey-registration-failed.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import type {
  AuthAuditContext,
  AuthAuditMethod,
} from "@/features/auth/audit/auth-audit.model";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { MfaFactorRepository } from "@/features/auth/mfa/mfa-factor.repository";
import type { MfaRecoveryCodeService } from "@/features/auth/mfa/recovery/mfa-recovery-code.service";
import type { SecurityNotificationService } from "@/features/auth/security-notification/security-notification.service";
import type { DeviceTrustService } from "@/features/auth/device/device-trust.service";
import type { AuthSessionService } from "@/features/auth/session/session.service";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type {
  PasskeyChallengePurpose,
  PasskeyChallengeStore,
} from "./passkey-challenge.store";
import {
  MAX_PASSKEYS_PER_USER,
  PASSKEY_CHALLENGE_TTL_SECONDS,
  toPasskeyDeviceType,
  toPasskeyTransports,
  type PasskeyAssertionCredential,
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

/**
 * EdDSA, ES256 and RS256: what authenticators actually use. The library would
 * offer ML-DSA-44 first wherever Node supports it, but Node's ML-DSA is still
 * experimental, and a passkey made with it would stop working on a runtime
 * without it.
 */
const SUPPORTED_ALGORITHM_IDS = [-8, -7, -257];

interface PasskeyServiceOptions {
  passkeyRepository: PasskeyRepository;
  passkeyChallengeStore: PasskeyChallengeStore;
  usersRepository: Pick<UsersRepository, "findUserById">;
  mfaFactorRepository: Pick<MfaFactorRepository, "getSummary">;
  mfaRecoveryCodeService: Pick<MfaRecoveryCodeService, "generateSet">;
  authSessionService: Pick<AuthSessionService, "revokeManagedSessions">;
  authAuditService: AuthAuditService;
  securityNotificationService: SecurityNotificationService;
  deviceTrustService: Pick<DeviceTrustService, "revokeAll">;
  /** Defaults to the `webauthn` config, read on each request. */
  getConfig?: () => WebAuthnConfig;
}

/** The session a passkey is being managed from. */
export interface PasskeyActor {
  userId: Uuid;
  sessionId: string;
  context?: AuthAuditContext;
}

/** Where an assertion is being used, for its challenge and its audit trail. */
export type PasskeyAssertionPurpose = Extract<
  PasskeyChallengePurpose,
  "step-up" | "login"
>;

export interface VerifyPasskeyAssertionInput {
  userId: Uuid;
  purpose: PasskeyAssertionPurpose;
  /** What the challenge was bound to when it was issued. */
  binding: string;
  credential: PasskeyAssertionCredential;
  /** Absent at sign-in, where the session does not exist yet. */
  sessionId?: string;
  /** How the first step signed in, when this is the second step of a sign-in. */
  method?: AuthAuditMethod;
  context?: AuthAuditContext;
}

/** Why an assertion failed; logged and audited, never told to the client. */
type AssertionFailure =
  | "challenge_missing"
  | "unknown_credential"
  | "user_handle_mismatch"
  | "verification_failed"
  | "counter_regressed"
  | "counter_race";

/**
 * Passkeys as a second factor: registering one, listing, renaming and
 * removing them, and checking an assertion for sign-in or step-up.
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
      userID: userHandleFor(actor.userId),
      userName: user.profile.username,
      userDisplayName: displayName,
      timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
      attestationType: "none",
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
      excludeCredentials: existing.map(toCredentialDescriptor),
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

  /**
   * Stores a verified passkey. An account that has never had recovery codes
   * gets a set with it, returned this once, so the first strong factor is
   * never active without a way back in.
   */
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

    // Ended before the passkey is stored, for the reason given on
    // `MfaTotpService.confirmEnrollment`.
    await this.options.deviceTrustService.revokeAll(
      actor.userId,
      "passkey_added",
      actor.context,
    );

    const info = verification.registrationInfo;
    const existingCount = await this.options.passkeyRepository.countByUserId(
      actor.userId,
    );
    const recoveryCodes = this.options.mfaRecoveryCodeService.generateSet(
      actor.userId,
    );
    let result: Awaited<ReturnType<PasskeyRepository["createWithinCap"]>>;

    try {
      result = await this.options.passkeyRepository.createWithinCap(
        {
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
        },
        recoveryCodes.rows,
      );
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
        recoveryCodesIssued: result.recoveryCodesIssued,
        emailNotification,
      },
    });

    return result.recoveryCodesIssued
      ? { passkey, recoveryCodes: recoveryCodes.codes }
      : { passkey };
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

  /**
   * Removing the account's last strong factor (no passkey left and no
   * authenticator) ends every other session and deletes the recovery codes,
   * as turning off the authenticator does. Removing one of several does
   * neither.
   *
   * The sessions go first, for the reason given on `MfaTotpService.disable`.
   * An authenticator turned off in between makes this the last factor after
   * all, and the sessions are ended once the delete reports it.
   */
  async remove(
    actor: PasskeyActor & { id: string; auth: JwtAuthPrincipal },
  ): Promise<void> {
    const existing = await this.options.passkeyRepository.findForUser(
      actor.userId,
      actor.id,
    );

    if (!existing) {
      throw new ResourceNotFoundError("Passkey not found.");
    }

    const factors = await this.options.mfaFactorRepository.getSummary(
      actor.userId,
    );
    let otherSessionsSignedOut = false;

    await this.options.deviceTrustService.revokeAll(
      actor.userId,
      "passkey_removed",
      actor.context,
    );

    if (!factors.totpActive && factors.passkeyCount <= 1) {
      await this.revokeOtherSessions(actor);
      otherSessionsSignedOut = true;
    }

    const removed = await this.options.passkeyRepository.deleteForUser(
      actor.userId,
      actor.id,
    );

    if (!removed) {
      throw new ResourceNotFoundError("Passkey not found.");
    }

    if (removed.lastStrongFactor && !otherSessionsSignedOut) {
      await this.revokeOtherSessions(actor);
      otherSessionsSignedOut = true;
    }

    const eventId = newUuid();
    const emailNotification =
      await this.options.securityNotificationService.notify({
        kind: "passkey_removed",
        details: {
          passkeyName: removed.row.name,
          endedOtherSessions: otherSessionsSignedOut,
        },
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
      metadata: {
        passkeyId: removed.row.id,
        lastStrongFactor: removed.lastStrongFactor,
        otherSessionsSignedOut,
        emailNotification,
      },
    });
  }

  /**
   * Request options for an assertion with one of the account's passkeys, and
   * the challenge it must answer, bound to `binding`. Asking again replaces
   * the challenge, so a cancelled prompt can simply be retried.
   */
  async beginAssertion(input: {
    userId: Uuid;
    purpose: PasskeyAssertionPurpose;
    binding: string;
    ttlSeconds?: number;
  }): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const rows = await this.options.passkeyRepository.listByUserId(
      input.userId,
    );

    if (rows.length === 0) {
      throw new MfaFactorUnavailableError();
    }

    const ttlSeconds = Math.min(
      PASSKEY_CHALLENGE_TTL_SECONDS,
      input.ttlSeconds ?? PASSKEY_CHALLENGE_TTL_SECONDS,
    );
    const options = await generateAuthenticationOptions({
      rpID: this.getConfig().rpId,
      allowCredentials: rows.map(toCredentialDescriptor),
      userVerification: "preferred",
      timeout: Math.max(1, Math.floor(ttlSeconds)) * 1000,
    });

    await this.options.passkeyChallengeStore.issue(
      input.purpose,
      input.binding,
      { challenge: options.challenge, userId: input.userId },
      ttlSeconds,
    );

    return options;
  }

  /**
   * Checks an assertion against the challenge issued for `binding`, which it
   * spends whatever the outcome. Throws {@link UnauthorizedError} without
   * saying why, so a caller counts every failure the way it counts a wrong
   * code.
   *
   * The library's own counter check is turned off (it is given 0) because it
   * would also refuse a synced passkey, whose counter means nothing. Instead
   * the counter is checked here, after the signature: a single-device passkey
   * whose counter did not go up may have been cloned, so the assertion is
   * refused and audited as `mfa.passkey_assertion_rejected`.
   */
  async verifyAssertion(
    input: VerifyPasskeyAssertionInput,
  ): Promise<{ passkeyId: string }> {
    const challenge = await this.options.passkeyChallengeStore.consume(
      input.purpose,
      input.binding,
    );

    if (!challenge || challenge.userId !== input.userId) {
      return this.rejectAssertion(input, "challenge_missing");
    }

    const row = await this.options.passkeyRepository.findByCredentialIdForUser(
      input.userId,
      isoBase64URL.toBuffer(input.credential.rawId),
    );

    if (!row) {
      return this.rejectAssertion(input, "unknown_credential");
    }

    const userHandle = input.credential.response.userHandle;

    if (
      userHandle !== undefined &&
      userHandle !== isoBase64URL.fromBuffer(userHandleFor(input.userId))
    ) {
      return this.rejectAssertion(input, "user_handle_mismatch", row);
    }

    const config = this.getConfig();
    let verification: VerifiedAuthenticationResponse;

    try {
      verification = await verifyAuthenticationResponse({
        response: input.credential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        credential: {
          id: isoBase64URL.fromBuffer(row.credentialId),
          publicKey: row.publicKey,
          counter: 0,
          transports: readTransports(row),
        },
        requireUserVerification: false,
      });
    } catch (error) {
      return this.rejectAssertion(
        input,
        "verification_failed",
        row,
        error instanceof Error ? error.message : "unknown",
      );
    }

    if (!verification.verified) {
      return this.rejectAssertion(input, "verification_failed", row);
    }

    const { newCounter, credentialBackedUp } = verification.authenticationInfo;
    const storedCounter = Number(row.signCount);
    const counterRegressed =
      (newCounter > 0 || storedCounter > 0) && newCounter <= storedCounter;

    if (counterRegressed && row.deviceType === "single_device") {
      await this.options.authAuditService.recordSafely({
        eventType: "mfa.passkey_assertion_rejected",
        outcome: "failure",
        reasonCode: "mfa_invalid",
        userId: input.userId,
        sessionId: input.sessionId,
        method: input.method,
        context: input.context,
        metadata: {
          passkeyId: row.id,
          stage: input.purpose === "login" ? "login" : "step_up",
          reason: "counter_regressed",
          storedCounter,
          receivedCounter: newCounter,
        },
      });
      return this.rejectAssertion(input, "counter_regressed", row);
    }

    const claimed = await this.options.passkeyRepository.claimSignCount({
      id: row.id,
      expectedSignCount: row.signCount,
      // A synced passkey's counter may go backwards; it never moves ours back.
      signCount: Math.max(storedCounter, newCounter),
      backedUp: credentialBackedUp,
      usedAt: new Date(),
    });

    if (!claimed) {
      return this.rejectAssertion(input, "counter_race", row);
    }

    return { passkeyId: row.id };
  }

  private rejectAssertion(
    input: VerifyPasskeyAssertionInput,
    reason: AssertionFailure,
    row?: UserWebAuthnCredential,
    detail?: string,
  ): never {
    this.logger.warn("Passkey assertion refused.", {
      userId: input.userId,
      sessionId: input.sessionId,
      purpose: input.purpose,
      passkeyId: row?.id,
      reason,
      detail,
    });
    throw new UnauthorizedError("MFA verification failed.");
  }

  private async revokeOtherSessions(
    actor: PasskeyActor & { auth: JwtAuthPrincipal },
  ): Promise<void> {
    await this.options.authSessionService.revokeManagedSessions({
      auth: actor.auth,
      scope: "others",
      audit: actor.context,
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

/** The WebAuthn user handle: the account id's bytes. */
function userHandleFor(userId: Uuid): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(userId);
}

function readTransports(row: UserWebAuthnCredential): string[] {
  return Array.isArray(row.transports)
    ? row.transports.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

function toCredentialDescriptor(row: UserWebAuthnCredential) {
  return {
    id: isoBase64URL.fromBuffer(row.credentialId),
    transports: toPasskeyTransports(readTransports(row)),
  };
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
