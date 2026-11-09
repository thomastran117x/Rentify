import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { loggerFactory, type Logger } from "@/configuration/logging";
import BadRequestError from "@/errors/http/bad-request.error";
import TooManyRequestError from "@/errors/http/too-many-request.error";
import type { CacheService } from "@/features/cache/cache.service";

interface OtpServiceOptions {
  cache: CacheService;
  /** HMAC key for the stored codes. Rotating it only voids outstanding codes. */
  hashSecret: string;
  /**
   * Also keeps each code readable under a separate key, for the non-production
   * preview routes. Production leaves it off, so Redis holds only hashes.
   */
  previewEnabled?: boolean;
  codeLength?: number;
  ttlInSeconds?: number;
  resendCooldownInSeconds?: number;
  maxAttempts?: number;
  cachePrefix?: string;
}

/**
 * Codes issued before hashing stored `code` instead, and are refused: they
 * lived ten minutes, so invalidating them on deploy costs a resend at most.
 */
interface CachedOtpRecord {
  codeHash?: unknown;
}

export interface IssueOtpInput {
  purpose: string;
  subject: string;
}

export interface VerifyOtpInput {
  purpose: string;
  subject: string;
  code: string;
  /**
   * Runs once the code has matched and before it is spent. If it throws, the
   * code stays valid, so the caller can refuse the rest of the request (a new
   * password the policy rejects, say) without making the user wait for another
   * email. The attempt still counts.
   */
  beforeConsume?: () => Promise<void>;
}

export interface PeekOtpInput {
  purpose: string;
  subject: string;
}

export interface IssuedOtpResult {
  ttlInSeconds: number;
  resendAvailableInSeconds: number;
}

/** `details.reason` on the 429 an exhausted attempt budget answers with. */
export const OTP_ATTEMPTS_EXHAUSTED_REASON = "otp-attempts-exhausted";

const DEFAULTS = {
  codeLength: 6,
  ttlInSeconds: 10 * 60,
  resendCooldownInSeconds: 60,
  maxAttempts: 5,
  cachePrefix: "auth:otp",
} as const;

/**
 * Emailed one-time codes, keyed by purpose and subject.
 *
 * Redis holds an HMAC of each code, never the code. Guesses are counted per
 * purpose and subject rather than per code: a resend replaces the code but
 * keeps the count, so asking for a new code never buys more guesses. Once the
 * count reaches `maxAttempts` no new code is issued until it expires, which is
 * one code TTL after the last code was issued.
 */
export class OtpService {
  private readonly logger: Logger;
  private readonly cache: CacheService;
  private readonly hashSecret: string;
  private readonly previewEnabled: boolean;
  private readonly codeLength: number;
  private readonly ttlInSeconds: number;
  private readonly resendCooldownInSeconds: number;
  private readonly maxAttempts: number;
  private readonly cachePrefix: string;

  constructor(options: OtpServiceOptions) {
    this.logger = loggerFactory.forClass(OtpService, "service");
    this.cache = options.cache;
    this.hashSecret = options.hashSecret;
    this.previewEnabled = options.previewEnabled ?? false;
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

    const attemptsKey = this.getAttemptsKey(input);

    if ((await this.readAttemptsUsed(attemptsKey)) >= this.maxAttempts) {
      this.logSuspiciousActivity(input, "issue-refused-attempts-exhausted");
      throw new TooManyRequestError(
        "Too many incorrect codes. Try again later.",
        {
          retryAfterSeconds: Math.max(await this.cache.ttl(attemptsKey), 1),
          reason: OTP_ATTEMPTS_EXHAUSTED_REASON,
        },
      );
    }

    // The count carries over; only its expiry moves, so it outlives the code
    // about to be issued. A refused issue never gets here, which is what lets
    // an exhausted budget run out.
    if (
      !(await this.cache.setIfNotExists(attemptsKey, "0", this.ttlInSeconds))
    ) {
      await this.cache.expire(attemptsKey, this.ttlInSeconds);
    }

    const code = this.generateCode();

    await this.cache.setJson(
      this.getOtpKey(input),
      { codeHash: this.hashCode(input, code) } satisfies CachedOtpRecord,
      this.ttlInSeconds,
    );

    if (this.previewEnabled) {
      await this.cache.set(this.getPreviewKey(input), code, this.ttlInSeconds);
    }

    await this.cache.set(cooldownKey, "1", this.resendCooldownInSeconds);

    return {
      code,
      ttlInSeconds: this.ttlInSeconds,
      resendAvailableInSeconds: this.resendCooldownInSeconds,
    };
  }

  /** Non-production only: there is nothing to read back when it is off. */
  async peek(
    input: PeekOtpInput,
  ): Promise<{ code: string; expiresInSeconds: number } | null> {
    if (!this.previewEnabled) {
      return null;
    }

    const code = await this.cache.get(this.getPreviewKey(input));

    if (code === null) {
      return null;
    }

    const ttl = await this.cache.ttl(this.getOtpKey(input));

    if (ttl <= 0) {
      return null;
    }

    return {
      code,
      expiresInSeconds: ttl,
    };
  }

  async verify(input: VerifyOtpInput): Promise<void> {
    const otpKey = this.getOtpKey(input);
    const record = await this.cache.getJson<CachedOtpRecord>(otpKey);

    if (!record || typeof record.codeHash !== "string") {
      if (record) {
        await this.cache.delete(otpKey);
      }

      this.logSuspiciousActivity(input, "missing-or-expired");
      throw new BadRequestError("Verification code is invalid or has expired.");
    }

    // Spent before the comparison, so concurrent guesses cannot all read the
    // same remaining count and overrun it.
    const attemptsKey = this.getAttemptsKey(input);
    const attemptsUsed = await this.cache.increment(attemptsKey);

    if (attemptsUsed === 1 && (await this.cache.ttl(attemptsKey)) < 0) {
      // The count expired just before the code did and INCR recreated it
      // without an expiry. Left alone it would never reset.
      await this.cache.expire(attemptsKey, this.ttlInSeconds);
    }

    const attemptsRemaining = Math.max(this.maxAttempts - attemptsUsed, 0);

    if (attemptsUsed > this.maxAttempts) {
      await this.discardCode(input);
      this.logSuspiciousActivity(input, "attempts-exhausted");
      throw new BadRequestError("Verification code is invalid.", {
        attemptsRemaining: 0,
      });
    }

    if (!this.matches(record.codeHash, input)) {
      if (attemptsRemaining === 0) {
        await this.discardCode(input);
        this.logSuspiciousActivity(input, "attempts-exhausted");
      }

      throw new BadRequestError("Verification code is invalid.", {
        attemptsRemaining,
      });
    }

    await input.beforeConsume?.();

    // Of two requests holding the right code, only the one whose delete
    // removed it may go on to use it.
    if (!(await this.cache.delete(otpKey))) {
      this.logSuspiciousActivity(input, "already-used");
      throw new BadRequestError("Verification code is invalid or has expired.");
    }

    await this.cache.deleteMany([
      this.getCooldownKey(input),
      attemptsKey,
      this.getPreviewKey(input),
    ]);
  }

  /** Leaves the attempt count behind, so `issue` keeps refusing. */
  private async discardCode(input: PeekOtpInput): Promise<void> {
    await this.cache.deleteMany([
      this.getOtpKey(input),
      this.getPreviewKey(input),
    ]);
  }

  private async readAttemptsUsed(attemptsKey: string): Promise<number> {
    const value = Number.parseInt(
      (await this.cache.get(attemptsKey)) ?? "",
      10,
    );
    return Number.isFinite(value) ? value : 0;
  }

  private generateCode(): string {
    const max = 10 ** this.codeLength;
    return randomInt(0, max).toString().padStart(this.codeLength, "0");
  }

  /** Bound to purpose and subject, so a stored hash is good for nothing else. */
  private hashCode(input: PeekOtpInput, code: string): string {
    return this.computeHash(input, code).toString("base64url");
  }

  private computeHash(input: PeekOtpInput, code: string): Buffer {
    return createHmac("sha256", this.hashSecret)
      .update(`${input.purpose}|${input.subject.toLowerCase()}|${code}`)
      .digest();
  }

  private matches(storedHash: string, input: VerifyOtpInput): boolean {
    const expected = Buffer.from(storedHash, "base64url");
    const actual = this.computeHash(input, input.code.trim());

    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private getOtpKey(input: PeekOtpInput): string {
    return `${this.cachePrefix}:${input.purpose}:${input.subject.toLowerCase()}`;
  }

  private getCooldownKey(input: PeekOtpInput): string {
    return `${this.getOtpKey(input)}:cooldown`;
  }

  private getAttemptsKey(input: PeekOtpInput): string {
    return `${this.getOtpKey(input)}:attempts`;
  }

  /** A namespace of its own, so nothing under the code prefix is plaintext. */
  private getPreviewKey(input: PeekOtpInput): string {
    return `${this.cachePrefix}-preview:${input.purpose}:${input.subject.toLowerCase()}`;
  }

  private logSuspiciousActivity(input: PeekOtpInput, reason: string): void {
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
