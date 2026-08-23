import { loggerFactory, type Logger } from "@/configuration/logging";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { CacheService } from "@/features/cache/cache.service";
import { EmailService } from "@/features/email/email.service";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { OtpService } from "@/features/auth/otp/otp.service";
import {
  EMAIL_VERIFICATION_OTP_PURPOSE,
  LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
  LOCAL_PASSWORD_RESET_OTP_PURPOSE,
} from "@/features/auth/otp/otp-purposes";
import { redactEmail } from "@/features/auth/redact-email";

const PUBLIC_OTP_RATE_LIMIT_WINDOW_IN_SECONDS = 60 * 60;
const PUBLIC_OTP_EMAIL_LIMIT = 5;
const PUBLIC_OTP_IP_LIMIT = 20;
const PUBLIC_OTP_DEVICE_LIMIT = 10;

type PublicOtpRateLimitScope = "email" | "ip" | "device";

interface PublicOtpRateLimitRecord {
  count: number;
}

export interface PublicOtpRateLimitResult {
  allowed: boolean;
  flow: string;
  purpose: string;
  subject: string;
  reason?: string;
  scope?: PublicOtpRateLimitScope;
}

export interface VerificationRecipient {
  email: string;
  firstName?: string;
}

/**
 * The OTP surface reachable without a session: signup verification, password
 * reset, username reminders and login unlock.
 *
 * These endpoints answer identically whether or not the account exists, so an
 * attacker cannot enumerate addresses. That means the usual defence of
 * returning an error is unavailable, and the rate limit here is what stops the
 * endpoints being used as a free mail cannon. It counts per email, per IP and
 * per device independently, so tripping one does not require tripping all.
 */
export class PublicOtpService {
  private readonly logger: Logger;

  constructor(
    private readonly cacheService: CacheService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
  ) {
    this.logger = loggerFactory.forClass(PublicOtpService, "service");
  }

  async consumeRateLimit(input: {
    purpose: string;
    subject: string;
    client: ClientRequestContext;
    deviceId?: string;
    flow: string;
  }): Promise<PublicOtpRateLimitResult> {
    const checks: Array<{
      scope: PublicOtpRateLimitScope;
      value?: string;
      limit: number;
    }> = [
      {
        scope: "email",
        value: input.subject.toLowerCase(),
        limit: PUBLIC_OTP_EMAIL_LIMIT,
      },
      {
        scope: "ip",
        value: input.client.ip,
        limit: PUBLIC_OTP_IP_LIMIT,
      },
      {
        scope: "device",
        value: input.deviceId ?? input.client.device.id,
        limit: PUBLIC_OTP_DEVICE_LIMIT,
      },
    ];
    const records: Array<{
      key: string;
      scope: PublicOtpRateLimitScope;
      count: number;
      limit: number;
    }> = [];

    for (const check of checks) {
      if (!check.value) {
        continue;
      }

      const key = this.getKey(input.purpose, check.scope, check.value);
      const record =
        await this.cacheService.getJson<PublicOtpRateLimitRecord>(key);
      const count = record?.count ?? 0;

      if (count >= check.limit) {
        return {
          allowed: false,
          flow: input.flow,
          purpose: input.purpose,
          subject: input.subject,
          reason: `${check.scope}-rate-limit`,
          scope: check.scope,
        };
      }

      records.push({
        key,
        scope: check.scope,
        count,
        limit: check.limit,
      });
    }

    await Promise.all(
      records.map((record) =>
        this.cacheService.setJson(
          record.key,
          {
            count: record.count + 1,
          } satisfies PublicOtpRateLimitRecord,
          PUBLIC_OTP_RATE_LIMIT_WINDOW_IN_SECONDS,
        ),
      ),
    );

    return {
      allowed: true,
      flow: input.flow,
      purpose: input.purpose,
      subject: input.subject,
    };
  }

  logSuspicious(result: PublicOtpRateLimitResult): void {
    this.logger.warn("Suspicious public OTP activity", {
      flow: result.flow,
      purpose: result.purpose,
      subject: redactEmail(result.subject),
      reason: result.reason,
      scope: result.scope,
    });
  }

  async sendEmailVerificationCode(
    recipient: VerificationRecipient,
  ): Promise<void> {
    const issuedOtp = await this.otpService.issue({
      purpose: EMAIL_VERIFICATION_OTP_PURPOSE,
      subject: recipient.email,
    });

    await this.emailService.sendVerificationEmail({
      to: recipient.email,
      verificationCode: issuedOtp.code,
      firstName: recipient.firstName,
      expiresInMinutes: Math.round(issuedOtp.ttlInSeconds / 60),
    });
  }

  /**
   * As {@link sendEmailVerificationCode}, but swallows the OTP cooldown so a
   * caller hammering resend still gets the same "accepted" answer as everyone
   * else rather than learning the address is real.
   */
  async sendPublicEmailVerificationCode(
    recipient: VerificationRecipient,
  ): Promise<void> {
    try {
      await this.sendEmailVerificationCode(recipient);
    } catch (error) {
      if (this.isCooldown(error)) {
        this.logSuspicious({
          allowed: false,
          flow: "resend-verification-email",
          purpose: EMAIL_VERIFICATION_OTP_PURPOSE,
          subject: recipient.email,
          reason: "otp-cooldown",
        });
        return;
      }

      throw error;
    }
  }

  async sendPasswordResetCode(user: AuthUserRecord): Promise<void> {
    try {
      const issuedOtp = await this.otpService.issue({
        purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
        subject: user.email,
      });

      await this.emailService.sendPasswordResetEmail({
        to: user.email,
        resetCode: issuedOtp.code,
        firstName: user.firstName,
        expiresInMinutes: Math.round(issuedOtp.ttlInSeconds / 60),
      });
    } catch (error) {
      if (this.isCooldown(error)) {
        this.logSuspicious({
          allowed: false,
          flow: "password-reset",
          purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
          subject: user.email,
          reason: "otp-cooldown",
        });
        return;
      }

      throw error;
    }
  }

  async sendUsernameReminder(user: AuthUserRecord): Promise<void> {
    await this.emailService.sendUsernameReminderEmail({
      to: user.email,
      username: user.profile.username,
      firstName: user.firstName,
    });
  }

  async sendLoginUnlockCode(user: AuthUserRecord | null): Promise<void> {
    if (!user) {
      return;
    }

    try {
      const issuedOtp = await this.otpService.issue({
        purpose: LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
        subject: user.email,
      });

      await this.emailService.sendLoginUnlockEmail({
        to: user.email,
        unlockCode: issuedOtp.code,
        firstName: user.firstName,
      });
    } catch (error) {
      if (this.isCooldown(error)) {
        this.logSuspicious({
          allowed: false,
          flow: "local-login-unlock",
          purpose: LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
          subject: user.email,
          reason: "otp-cooldown",
        });
        return;
      }

      throw error;
    }
  }

  private getKey(
    purpose: string,
    scope: PublicOtpRateLimitScope,
    value: string,
  ): string {
    return `auth:otp-rate:${purpose}:${scope}:${value.toLowerCase()}`;
  }

  private isCooldown(error: unknown): boolean {
    return error instanceof Error && error.name === "TooManyRequestError";
  }
}
