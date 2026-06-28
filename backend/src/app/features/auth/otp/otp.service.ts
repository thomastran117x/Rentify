import { randomInt } from "node:crypto";
import { loggerFactory, type Logger } from "@/configuration/logging";
import BadRequestError from "@/errors/http/bad-request.error";
import TooManyRequestError from "@/errors/http/too-many-request.error";
import type { CacheService } from "@/features/cache/cache.service";

interface OtpServiceOptions {
  cache: CacheService;
  codeLength?: number;
  ttlInSeconds?: number;
  resendCooldownInSeconds?: number;
  maxAttempts?: number;
  cachePrefix?: string;
}

interface CachedOtpRecord {
  code: string;
  attemptsRemaining: number;
}

export interface IssueOtpInput {
  purpose: string;
  subject: string;
}

export interface VerifyOtpInput {
  purpose: string;
  subject: string;
  code: string;
}

export interface PeekOtpInput {
  purpose: string;
  subject: string;
}

export interface IssuedOtpResult {
  ttlInSeconds: number;
  resendAvailableInSeconds: number;
}

const DEFAULTS = {
  codeLength: 6,
  ttlInSeconds: 10 * 60,
  resendCooldownInSeconds: 60,
  maxAttempts: 5,
  cachePrefix: "auth:otp",
} as const;

export class OtpService {
  private readonly logger: Logger;
  private readonly cache: CacheService;
  private readonly codeLength: number;
  private readonly ttlInSeconds: number;
  private readonly resendCooldownInSeconds: number;
  private readonly maxAttempts: number;
  private readonly cachePrefix: string;

  constructor(options: OtpServiceOptions) {
    this.logger = loggerFactory.forClass(OtpService, "service");
    this.cache = options.cache;
    this.codeLength = options.codeLength ?? DEFAULTS.codeLength;
    this.ttlInSeconds = options.ttlInSeconds ?? DEFAULTS.ttlInSeconds;
    this.resendCooldownInSeconds =
      options.resendCooldownInSeconds ?? DEFAULTS.resendCooldownInSeconds;
    this.maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
    this.cachePrefix = options.cachePrefix ?? DEFAULTS.cachePrefix;
  }

  getTtlInSeconds(): number {
    return this.ttlInSeconds;
  }

  async issue(
    input: IssueOtpInput,
  ): Promise<IssuedOtpResult & { code: string }> {
    const cooldownKey = this.getCooldownKey(input);
    const cooldownTtl = await this.cache.ttl(cooldownKey);

    if (cooldownTtl > 0) {
      throw new TooManyRequestError("A verification code was sent recently.", {
        retryAfterSeconds: cooldownTtl,
      });
    }

    const code = this.generateCode();
    const otpKey = this.getOtpKey(input);

    await this.cache.setJson(
      otpKey,
      {
        code,
        attemptsRemaining: this.maxAttempts,
      } satisfies CachedOtpRecord,
      this.ttlInSeconds,
    );

    await this.cache.set(cooldownKey, "1", this.resendCooldownInSeconds);

    return {
      code,
      ttlInSeconds: this.ttlInSeconds,
      resendAvailableInSeconds: this.resendCooldownInSeconds,
    };
  }

  async peek(
    input: PeekOtpInput,
  ): Promise<{ code: string; expiresInSeconds: number } | null> {
    const otpKey = this.getOtpKey(input);
    const record = await this.cache.getJson<CachedOtpRecord>(otpKey);

    if (!record) {
      return null;
    }

    const ttl = await this.cache.ttl(otpKey);

    if (ttl <= 0) {
      return null;
    }

    return {
      code: record.code,
      expiresInSeconds: ttl,
    };
  }

  async verify(input: VerifyOtpInput): Promise<void> {
    const otpKey = this.getOtpKey(input);
    const record = await this.cache.getJson<CachedOtpRecord>(otpKey);

    if (!record) {
      this.logSuspiciousVerificationAttempt(input, "missing-or-expired");
      throw new BadRequestError("Verification code is invalid or has expired.");
    }

    const normalizedCode = input.code.trim();

    if (record.code !== normalizedCode) {
      const attemptsRemaining = Math.max(record.attemptsRemaining - 1, 0);
      const ttl = await this.cache.ttl(otpKey);

      if (attemptsRemaining <= 0 || ttl <= 0) {
        await this.cache.delete(otpKey);
        this.logSuspiciousVerificationAttempt(input, "attempts-exhausted");
      } else {
        await this.cache.setJson(
          otpKey,
          {
            ...record,
            attemptsRemaining,
          } satisfies CachedOtpRecord,
          ttl,
        );
      }

      throw new BadRequestError("Verification code is invalid.", {
        attemptsRemaining,
      });
    }

    await this.cache.delete(otpKey);
    await this.cache.delete(this.getCooldownKey(input));
  }

  private generateCode(): string {
    const max = 10 ** this.codeLength;
    return randomInt(0, max).toString().padStart(this.codeLength, "0");
  }

  private getOtpKey(input: { purpose: string; subject: string }): string {
    return `${this.cachePrefix}:${input.purpose}:${input.subject.toLowerCase()}`;
  }

  private getCooldownKey(input: { purpose: string; subject: string }): string {
    return `${this.getOtpKey(input)}:cooldown`;
  }

  private logSuspiciousVerificationAttempt(
    input: VerifyOtpInput,
    reason: string,
  ): void {
    this.logger.warn("Suspicious OTP verification activity", {
      purpose: input.purpose,
      subject: this.redactSubject(input.subject),
      reason,
    });
  }

  private redactSubject(subject: string): string {
    const [localPart, domain] = subject.toLowerCase().split("@");

    if (!localPart || !domain) {
      return "redacted";
    }

    return `${localPart.slice(0, 1)}***@${domain}`;
  }
}

