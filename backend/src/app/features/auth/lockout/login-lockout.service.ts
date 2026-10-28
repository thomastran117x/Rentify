import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import type { CacheService } from "@/features/cache/cache.service";
import { OtpService } from "@/features/auth/otp/otp.service";
import { LOCAL_LOGIN_UNLOCK_OTP_PURPOSE } from "@/features/auth/otp/otp-purposes";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";
import type {
  LocalLoginAttemptRecord,
  ResendUnlockLocalLoginInput,
  UnlockLocalLoginInput,
} from "@/features/auth/lockout/login-lockout.model";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type {
  AuthAuditReasonCode,
  RecordAuthAuditEventInput,
} from "@/features/auth/audit/auth-audit.model";
import LockedError from "@/errors/http/locked.error";
import { asUuid } from "@/configuration/validation/uuid";

const MAX_FAILED_LOCAL_LOGIN_ATTEMPTS = 5;
const LOCAL_LOGIN_ATTEMPT_TTL_IN_SECONDS = 15 * 60;
export const LOCAL_LOGIN_LOCK_TTL_IN_SECONDS = 30 * 60;

/** The fields every audit event for one sign-in attempt shares. */
export type LoginAttemptAuditBase = Pick<
  RecordAuthAuditEventInput,
  "method" | "identifierHash" | "context"
>;

/**
 * Throttles local credential guessing by locking an account after repeated
 * password or login-time authenticator failures, and owns the emailed code
 * that lifts the lock.
 *
 * Attempts are counted per username in the cache rather than on the user row:
 * an unknown username has no row to count against, and it must be locked out on
 * the same schedule as a real one or the difference reveals which usernames
 * exist.
 */
export class LoginLockoutService {
  constructor(
    private readonly cacheService: CacheService,
    private readonly usersRepository: UsersRepository,
    private readonly otpService: OtpService,
    private readonly publicOtpService: PublicOtpService,
    private readonly authAuditService: AuthAuditService,
  ) {}

  async getAttemptRecord(
    username: string,
  ): Promise<LocalLoginAttemptRecord | null> {
    return this.cacheService.getJson<LocalLoginAttemptRecord>(
      this.getKey(username),
    );
  }

  async recordFailedAttempt(
    username: string,
  ): Promise<LocalLoginAttemptRecord> {
    const existingRecord = await this.getAttemptRecord(username);
    const nextFailedAttempts = (existingRecord?.failedAttempts ?? 0) + 1;
    const nextRecord: LocalLoginAttemptRecord =
      nextFailedAttempts >= MAX_FAILED_LOCAL_LOGIN_ATTEMPTS
        ? {
            failedAttempts: nextFailedAttempts,
            lockedAt: new Date().toISOString(),
          }
        : {
            failedAttempts: nextFailedAttempts,
          };

    await this.cacheService.setJson(
      this.getKey(username),
      nextRecord,
      nextRecord.lockedAt
        ? LOCAL_LOGIN_LOCK_TTL_IN_SECONDS
        : LOCAL_LOGIN_ATTEMPT_TTL_IN_SECONDS,
    );

    return nextRecord;
  }

  /**
   * Counts the failure and records it, as `failureEventType`, or as the
   * `login.locked` it turned into when it was the attempt that set the lock.
   */
  async recordFailedLogin(input: {
    username: string;
    user: AuthUserRecord | null;
    reasonCode: AuthAuditReasonCode;
    audit: LoginAttemptAuditBase;
    failureEventType?: "login.failed" | "oauth.login.failed";
  }): Promise<void> {
    const updatedAttemptRecord = await this.recordFailedAttempt(input.username);

    if (updatedAttemptRecord.lockedAt) {
      await this.recordLockedLogin(input.user, input.audit, {
        triggered: true,
        failureReason: input.reasonCode,
      });
      await this.throwLockedLogin(input.user);
    }

    await this.authAuditService.recordSafely({
      ...input.audit,
      eventType: input.failureEventType ?? "login.failed",
      outcome: "failure",
      reasonCode: input.reasonCode,
      userId: input.user ? asUuid(input.user.id) : null,
    });
  }

  async recordLockedLogin(
    user: AuthUserRecord | null,
    audit: LoginAttemptAuditBase,
    metadata?: RecordAuthAuditEventInput["metadata"],
  ): Promise<void> {
    await this.authAuditService.recordSafely({
      ...audit,
      eventType: "login.locked",
      outcome: "blocked",
      reasonCode: "locked",
      userId: user ? asUuid(user.id) : null,
      metadata,
    });
  }

  /** Emails the unlock code, then refuses the sign-in. */
  async throwLockedLogin(user: AuthUserRecord | null): Promise<never> {
    await this.sendUnlockCode(user);
    throw new LockedError(
      "This sign-in is locked. Use the code we emailed you to unlock it.",
      this.buildLockedLoginDetails(user),
    );
  }

  async clearAttemptRecord(username: string): Promise<void> {
    await this.cacheService.delete(this.getKey(username));
  }

  async isLocked(username: string): Promise<boolean> {
    const record = await this.getAttemptRecord(username);
    return Boolean(record?.lockedAt);
  }

  /**
   * The email is included only when the account exists, so a locked response
   * for an unknown username carries nothing back.
   */
  buildLockedLoginDetails(user: AuthUserRecord | null) {
    return {
      ...(user ? { email: user.email } : {}),
      unlockRequired: true,
    };
  }

  async sendUnlockCode(user: AuthUserRecord | null): Promise<void> {
    await this.publicOtpService.sendLoginUnlockCode(user);
  }

  /**
   * The unlock routes are keyed by email, so their audit events hash the typed
   * email where sign-in events hash the username.
   */
  async unlockLocalLogin(input: UnlockLocalLoginInput): Promise<{
    unlocked: true;
    email: string;
  }> {
    const identifierHash = this.authAuditService.hashIdentifier(input.email);

    try {
      await this.otpService.verify({
        purpose: LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
        subject: input.email,
        code: input.code,
      });
    } catch (error) {
      // Only to attribute the event: a failed lookup must not replace the
      // rejection the caller is owed.
      const user = await this.usersRepository
        .findUserByEmail(input.email)
        .catch(() => null);
      await this.authAuditService.recordSafely({
        eventType: "login.unlocked",
        outcome: "failure",
        reasonCode: "otp_invalid",
        userId: user ? asUuid(user.id) : null,
        identifierHash,
        context: input.audit,
      });
      throw error;
    }

    const user = await this.usersRepository.findUserByEmail(input.email);

    if (user) {
      await this.clearAttemptRecord(user.profile.username);
    }

    await this.authAuditService.recordSafely({
      eventType: "login.unlocked",
      outcome: "success",
      userId: user ? asUuid(user.id) : null,
      identifierHash,
      context: input.audit,
    });

    return {
      unlocked: true,
      email: input.email,
    };
  }

  async resendUnlockLocalLogin(input: ResendUnlockLocalLoginInput): Promise<{
    accepted: true;
  }> {
    const rateLimitResult = await this.publicOtpService.consumeRateLimit({
      purpose: LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
      subject: input.email,
      client: input.client,
      deviceId: input.deviceId,
      flow: "resend-unlock-local-login",
    });
    const audit = {
      eventType: "login.unlock_requested",
      identifierHash: this.authAuditService.hashIdentifier(input.email),
      context: input.audit,
    } as const;

    if (!rateLimitResult.allowed) {
      this.publicOtpService.logSuspicious(rateLimitResult);
      await this.authAuditService.recordSafely({
        ...audit,
        outcome: "blocked",
        reasonCode: "rate_limited",
      });
      return {
        accepted: true,
      };
    }

    const user = await this.usersRepository.findUserByEmail(input.email);
    const isLocked = user ? await this.isLocked(user.profile.username) : false;
    const userId = user ? asUuid(user.id) : null;

    // Only a locked account gets a code. Sending one regardless would let the
    // endpoint mail anybody on demand. The response stays the same either way;
    // only the audit event tells the cases apart.
    if (!isLocked) {
      await this.authAuditService.recordSafely({
        ...audit,
        outcome: "failure",
        reasonCode: "not_locked",
        userId,
      });
      return {
        accepted: true,
      };
    }

    await this.publicOtpService.sendLoginUnlockCode(user);
    await this.authAuditService.recordSafely({
      ...audit,
      outcome: "success",
      userId,
    });

    return {
      accepted: true,
    };
  }

  private getKey(username: string): string {
    return `auth:local-login-attempts:${username.toLowerCase()}`;
  }
}
