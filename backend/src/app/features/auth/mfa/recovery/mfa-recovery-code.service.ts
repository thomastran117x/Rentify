import { createHmac, randomBytes } from "node:crypto";
import ConflictError from "@/errors/http/conflict.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { newUuid, type Uuid } from "@/configuration/validation/uuid";
import type {
  AuthAuditContext,
  AuthAuditMethod,
} from "@/features/auth/audit/auth-audit.model";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { SecurityNotificationService } from "@/features/auth/security-notification/security-notification.service";
import {
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  type MfaRecoveryCodeRegenerateResult,
  type MfaRecoveryCodeStatusResult,
  type RecoveryCodeSet,
  type RecoveryCodeStage,
} from "./mfa-recovery-code.model";
import type { MfaRecoveryCodeRepository } from "./mfa-recovery-code.repository";

interface MfaRecoveryCodeServiceOptions {
  mfaRecoveryCodeRepository: MfaRecoveryCodeRepository;
  /** A key for this purpose alone, derived from the MFA encryption key. */
  hashKey: Buffer;
  authAuditService: AuthAuditService;
  securityNotificationService: SecurityNotificationService;
}

export interface RedeemRecoveryCodeInput {
  userId: Uuid;
  code: string;
  stage: RecoveryCodeStage;
  /** Absent at sign-in, where the session does not exist yet. */
  sessionId?: string;
  /** How the first step signed in, when this is the second step of a sign-in. */
  method?: AuthAuditMethod;
  context?: AuthAuditContext;
}

/**
 * Recovery codes are the way back in when an authenticator is lost. A code is
 * only a second factor for an account that has an active authenticator, so
 * the set is created with it and removed with it.
 *
 * Codes carry 50 random bits, so a fast keyed hash is enough: guessing is
 * limited online by the lockout and step-up limits, and a stolen table cannot
 * be searched offline without the key.
 */
export class MfaRecoveryCodeService {
  private readonly mfaRecoveryCodeRepository: MfaRecoveryCodeRepository;
  private readonly hashKey: Buffer;
  private readonly authAuditService: AuthAuditService;
  private readonly securityNotificationService: SecurityNotificationService;

  constructor(options: MfaRecoveryCodeServiceOptions) {
    this.mfaRecoveryCodeRepository = options.mfaRecoveryCodeRepository;
    this.hashKey = options.hashKey;
    this.authAuditService = options.authAuditService;
    this.securityNotificationService = options.securityNotificationService;
  }

  /** Nothing is stored: the caller writes `rows` with the change they belong to. */
  generateSet(userId: Uuid): RecoveryCodeSet {
    const codes = new Set<string>();

    while (codes.size < RECOVERY_CODE_COUNT) {
      codes.add(this.generateCode());
    }

    const canonical = [...codes];

    return {
      codes: canonical.map(formatRecoveryCode),
      rows: canonical.map((code) => ({
        id: newUuid(),
        userId,
        codeHash: this.hash(userId, code),
      })),
    };
  }

  async getStatus(userId: Uuid): Promise<MfaRecoveryCodeStatusResult> {
    const [remaining, createdAt] = await Promise.all([
      this.mfaRecoveryCodeRepository.countUnused(userId),
      this.mfaRecoveryCodeRepository.findSetCreatedAt(userId),
    ]);

    return { remaining, createdAt: createdAt?.toISOString() ?? null };
  }

  countUnused(userId: Uuid): Promise<number> {
    return this.mfaRecoveryCodeRepository.countUnused(userId);
  }

  /**
   * Spends a code, or throws without saying why: a wrong code and a used one
   * must look alike. The use is recorded as soon as it is claimed, because the
   * code is gone from then on even if the caller's next step fails.
   *
   * Returns how many unused codes are left.
   */
  async redeem(input: RedeemRecoveryCodeInput): Promise<number> {
    const code = normalizeRecoveryCode(input.code);
    const claimed =
      code !== null &&
      (await this.mfaRecoveryCodeRepository.claim(
        input.userId,
        this.hash(input.userId, code),
        new Date(),
      ));

    if (!claimed) {
      throw new UnauthorizedError("MFA verification failed.");
    }

    const remaining = await this.mfaRecoveryCodeRepository.countUnused(
      input.userId,
    );
    const eventId = newUuid();
    const emailNotification = await this.securityNotificationService.notify({
      kind: "mfa_recovery_code_used",
      details: { remaining },
      userId: input.userId,
      eventId,
      context: input.context,
    });

    await this.authAuditService.recordSafely({
      id: eventId,
      eventType: "mfa.recovery_code_used",
      outcome: "success",
      userId: input.userId,
      sessionId: input.sessionId,
      method: input.method,
      context: input.context,
      metadata: { remaining, stage: input.stage, emailNotification },
    });

    return remaining;
  }

  /** Replaces every code, used or not. */
  async regenerate(input: {
    userId: Uuid;
    sessionId?: string;
    context?: AuthAuditContext;
  }): Promise<MfaRecoveryCodeRegenerateResult> {
    const { codes, rows } = this.generateSet(input.userId);
    const createdAt = new Date();
    const replaced = await this.mfaRecoveryCodeRepository.replaceForActiveTotp(
      input.userId,
      rows,
      createdAt,
    );

    if (!replaced) {
      throw new ConflictError(
        "Turn on an authenticator app before generating recovery codes.",
      );
    }

    const eventId = newUuid();
    const emailNotification = await this.securityNotificationService.notify({
      kind: "mfa_recovery_codes_regenerated",
      details: {},
      userId: input.userId,
      eventId,
      context: input.context,
    });

    await this.authAuditService.recordSafely({
      id: eventId,
      eventType: "mfa.recovery_codes_regenerated",
      outcome: "success",
      userId: input.userId,
      sessionId: input.sessionId,
      context: input.context,
      metadata: { remaining: rows.length, emailNotification },
    });

    return {
      codes,
      remaining: rows.length,
      createdAt: createdAt.toISOString(),
    };
  }

  private generateCode(): string {
    // A byte's low 5 bits are uniform, and the alphabet is exactly 32 symbols.
    return Array.from(
      randomBytes(RECOVERY_CODE_LENGTH),
      (byte) => RECOVERY_CODE_ALPHABET[byte & 0x1f],
    ).join("");
  }

  /** Bound to the account, so equal codes on two accounts do not correlate. */
  private hash(userId: Uuid, code: string): string {
    return createHmac("sha256", this.hashKey)
      .update(`${userId}:${code}`)
      .digest("hex");
  }
}
