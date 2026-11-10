import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { MfaTotpRepository } from "./mfa-totp.repository";
import type { TotpService } from "./totp.service";
import type { MfaRecoveryCodeService } from "@/features/auth/mfa/recovery/mfa-recovery-code.service";
import type { MfaFactorRepository } from "@/features/auth/mfa/mfa-factor.repository";
import { asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import type { AuthSessionService } from "@/features/auth/session/session.service";
import type { SecurityNotificationService } from "@/features/auth/security-notification/security-notification.service";

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const PENDING_TTL_MINUTES = 15;

interface MfaTotpServiceOptions {
  totpService: TotpService;
  mfaTotpRepository: MfaTotpRepository;
  mfaRecoveryCodeService: MfaRecoveryCodeService;
  mfaFactorRepository: Pick<MfaFactorRepository, "getSummary">;
  encryptionKey: Buffer;
  authAuditService: AuthAuditService;
  authSessionService: AuthSessionService;
  securityNotificationService: SecurityNotificationService;
}

export interface MfaTotpDisableOutcome {
  /** Whether other sessions were ended, which only removing the last strong factor does. */
  otherSessionsSignedOut: boolean;
}

interface MfaTotpAuditInput {
  sessionId?: string;
  context: AuthAuditContext;
}

export class MfaTotpService {
  private readonly totpService: TotpService;
  private readonly mfaTotpRepository: MfaTotpRepository;
  private readonly mfaRecoveryCodeService: MfaRecoveryCodeService;
  private readonly mfaFactorRepository: Pick<MfaFactorRepository, "getSummary">;
  private readonly encryptionKey: Buffer;
  private readonly authAuditService: AuthAuditService;
  private readonly authSessionService: AuthSessionService;
  private readonly securityNotificationService: SecurityNotificationService;

  constructor(options: MfaTotpServiceOptions) {
    this.totpService = options.totpService;
    this.mfaTotpRepository = options.mfaTotpRepository;
    this.mfaRecoveryCodeService = options.mfaRecoveryCodeService;
    this.mfaFactorRepository = options.mfaFactorRepository;
    this.encryptionKey = options.encryptionKey;
    this.authAuditService = options.authAuditService;
    this.authSessionService = options.authSessionService;
    this.securityNotificationService = options.securityNotificationService;
  }

  async beginEnrollment(
    userId: Uuid,
    accountName: string,
  ): Promise<{ secret: string; uri: string }> {
    const existing = await this.mfaTotpRepository.findByUserId(userId);

    if (existing?.status === "active") {
      throw new ConflictError("MFA is already enabled.");
    }

    const { secret, uri } = this.totpService.generateSecret(accountName);
    const secretEncrypted = this.encrypt(secret);
    const expiresAt = new Date(Date.now() + PENDING_TTL_MINUTES * 60 * 1000);

    if (existing?.status === "pending") {
      const updated = await this.mfaTotpRepository.replacePending(
        existing.id,
        { secretEncrypted, expiresAt },
        existing.updatedAt,
      );

      // count=0 means either:
      // a) The record was concurrently activated → already enabled
      // b) Another replacePending beat us (updatedAt changed) → stale secret
      // Both cases require the client to retry to get a consistent secret.
      if (updated === 0) {
        throw new ConflictError(
          "Enrollment was updated concurrently. Please try again.",
        );
      }
    } else {
      try {
        await this.mfaTotpRepository.createPending({
          userId,
          secretEncrypted,
          expiresAt,
        });
      } catch (error) {
        // A concurrent request created a pending record between our read and
        // this insert (unique constraint on userId). Treat this as a retriable
        // condition — the client can re-call beginEnrollment to replace it.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new ConflictError(
            "MFA enrollment is already in progress. Please try again.",
          );
        }
        throw error;
      }
    }

    return { secret, uri };
  }

  /**
   * Returns the recovery codes, which are shown this once and never again.
   * The list is empty when the account already had a set from a passkey.
   */
  async confirmEnrollment(
    userId: Uuid,
    code: string,
    audit?: MfaTotpAuditInput,
  ): Promise<string[]> {
    const record = await this.mfaTotpRepository.findByUserId(userId);

    if (!record || record.status !== "pending") {
      throw new BadRequestError("No pending MFA setup found.");
    }

    // Treat null expiresAt as expired — every pending record must have an expiry.
    if (!record.expiresAt || record.expiresAt < new Date()) {
      throw new BadRequestError("MFA setup has expired. Please start over.");
    }

    const secret = this.decrypt(record.secretEncrypted);
    const matchedCounter = this.totpService.verifyCode(secret, code);

    if (matchedCounter === null) {
      throw new BadRequestError("Verification code is incorrect.");
    }

    // Persist the confirmed counter as lastUsedCounter so the enrollment code
    // cannot be replayed against verifyCode before the first login MFA check.
    const recoveryCodes = this.mfaRecoveryCodeService.generateSet(userId);
    const activation = await this.mfaTotpRepository.activate(
      record.id,
      userId,
      new Date(),
      matchedCounter,
      recoveryCodes.rows,
    );

    if (!activation.activated) {
      throw new ConflictError("MFA is already enabled.");
    }

    const eventId = newUuid();
    const emailNotification = await this.securityNotificationService.notify({
      kind: "mfa_enabled",
      details: {},
      userId,
      eventId,
      context: audit?.context,
    });

    if (audit) {
      await this.authAuditService.recordSafely({
        id: eventId,
        eventType: "mfa.totp_enabled",
        outcome: "success",
        userId,
        sessionId: audit.sessionId,
        context: audit.context,
        metadata: { emailNotification },
      });
    }

    return activation.recoveryCodesIssued ? recoveryCodes.codes : [];
  }

  async verifyCode(userId: Uuid, code: string): Promise<void> {
    const record = await this.mfaTotpRepository.findByUserId(userId);

    if (!record || record.status !== "active") {
      throw new UnauthorizedError("MFA verification failed.");
    }

    const secret = this.decrypt(record.secretEncrypted);
    const matchedCounter = this.totpService.verifyCode(secret, code);

    if (matchedCounter === null) {
      throw new UnauthorizedError("MFA verification failed.");
    }

    // Replay protection: reject any code whose counter is not strictly newer
    // than the last accepted one. lastUsedCounter is null for the first
    // verification after enrollment. This read only saves a write for an
    // obvious replay; the conditional claim below is what decides a race.
    const lastUsedCounter =
      record.lastUsedCounter !== null ? Number(record.lastUsedCounter) : -1;

    if (matchedCounter <= lastUsedCounter) {
      throw new UnauthorizedError("MFA verification failed.");
    }

    if (
      !(await this.mfaTotpRepository.claimCounter(record.id, matchedCounter))
    ) {
      throw new UnauthorizedError("MFA verification failed.");
    }
  }

  /**
   * Removing the account's last strong factor ends every other session, since
   * any of them could be the reason it is being removed. With a passkey left,
   * the account is still protected and the sessions stay.
   *
   * The sessions go first: if that fails the authenticator stays on and the
   * caller can retry, whereas the other order would leave it off with the
   * sessions alive and a retry that finds nothing to do. A passkey removed in
   * between makes this the last factor after all, and the sessions are ended
   * once the delete reports it.
   */
  async disable(
    auth: JwtAuthPrincipal,
    context: AuthAuditContext,
  ): Promise<MfaTotpDisableOutcome> {
    const userId = asUuid(auth.sub);
    const existing = await this.mfaTotpRepository.findByUserId(userId);
    const wasActive = existing?.status === "active";
    let otherSessionsSignedOut = false;

    if (
      wasActive &&
      (await this.mfaFactorRepository.getSummary(userId)).passkeyCount === 0
    ) {
      await this.revokeOtherSessions(auth, context);
      otherSessionsSignedOut = true;
    }

    const { lastStrongFactor } =
      await this.mfaTotpRepository.deleteByUserId(userId);

    if (wasActive && lastStrongFactor && !otherSessionsSignedOut) {
      await this.revokeOtherSessions(auth, context);
      otherSessionsSignedOut = true;
    }

    if (wasActive) {
      const eventId = newUuid();
      const emailNotification = await this.securityNotificationService.notify({
        kind: "mfa_disabled",
        details: { endedOtherSessions: otherSessionsSignedOut },
        userId,
        eventId,
        context,
      });

      await this.authAuditService.recordSafely({
        id: eventId,
        eventType: "mfa.totp_disabled",
        outcome: "success",
        userId,
        sessionId: auth.sessionId,
        context,
        metadata: {
          lastStrongFactor,
          otherSessionsSignedOut,
          emailNotification,
        },
      });
    }

    return { otherSessionsSignedOut };
  }

  private async revokeOtherSessions(
    auth: JwtAuthPrincipal,
    context: AuthAuditContext,
  ): Promise<void> {
    await this.authSessionService.revokeManagedSessions({
      auth,
      scope: "others",
      audit: context,
    });
  }

  // Cancels an in-progress enrollment by deleting the pending record.
  // A no-op if there is no pending record — leaves an active record untouched.
  async cancelEnrollment(userId: Uuid): Promise<void> {
    await this.mfaTotpRepository.deleteByUserIdIfPending(userId);
  }

  async isEnabled(userId: Uuid): Promise<boolean> {
    const record = await this.mfaTotpRepository.findByUserId(userId);
    return record?.status === "active";
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
  }

  private decrypt(ciphertext: string): string {
    const data = Buffer.from(ciphertext, "base64");
    const iv = data.subarray(0, IV_BYTES);
    const authTag = data.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const encrypted = data.subarray(IV_BYTES + AUTH_TAG_BYTES);

    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  }
}
