import { createHmac } from "node:crypto";
import BadRequestError from "@/errors/http/bad-request.error";
import TooManyRequestError from "@/errors/http/too-many-request.error";
import {
  OTP_ATTEMPTS_EXHAUSTED_REASON,
  OtpService,
} from "@/features/auth/otp/otp.service";

const HASH_SECRET = "otp-test-hash-secret-value-of-32-chars";
const PURPOSE = "verify-email";
const SUBJECT = "user@example.com";
const OTP_KEY = `auth:otp:${PURPOSE}:${SUBJECT}`;
const ATTEMPTS_KEY = `${OTP_KEY}:attempts`;
const COOLDOWN_KEY = `${OTP_KEY}:cooldown`;
const PREVIEW_KEY = `auth:otp-preview:${PURPOSE}:${SUBJECT}`;

/**
 * Enough of Redis for the service: string values with a TTL each, where -1 is
 * no expiry and -2 is a missing key. INCR keeps the TTL, as Redis does.
 */
class FakeCache {
  readonly entries = new Map<string, { value: string; ttl: number }>();

  async get(key: string): Promise<string | null> {
    return this.entries.get(key)?.value ?? null;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    return value === null ? null : (JSON.parse(value) as T);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.entries.set(key, { value, ttl: ttl ?? -1 });
  }

  async setJson(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttl);
  }

  async setIfNotExists(
    key: string,
    value: string,
    ttl?: number,
  ): Promise<boolean> {
    if (this.entries.has(key)) {
      return false;
    }

    await this.set(key, value, ttl);
    return true;
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    const entry = this.entries.get(key);

    if (!entry) {
      return false;
    }

    entry.ttl = ttl;
    return true;
  }

  async ttl(key: string): Promise<number> {
    return this.entries.get(key)?.ttl ?? -2;
  }

  async increment(key: string, amount = 1): Promise<number> {
    const entry = this.entries.get(key);
    const next = Number.parseInt(entry?.value ?? "0", 10) + amount;
    this.entries.set(key, { value: String(next), ttl: entry?.ttl ?? -1 });
    return next;
  }

  async delete(key: string): Promise<boolean> {
    return this.entries.delete(key);
  }

  async deleteMany(keys: string[]): Promise<number> {
    return keys.filter((key) => this.entries.delete(key)).length;
  }
}

function createService(options?: {
  previewEnabled?: boolean;
  ttlInSeconds?: number;
  resendCooldownInSeconds?: number;
  maxAttempts?: number;
}) {
  const cache = new FakeCache();
  const service = new OtpService({
    cache: cache as never,
    hashSecret: HASH_SECRET,
    ...options,
  });

  return { service, cache };
}

const input = { purpose: PURPOSE, subject: SUBJECT };

function wrongCodeFor(code: string): string {
  return code === "000000" ? "111111" : "000000";
}

/** Lets a resend through, as waiting out the cooldown would. */
async function endCooldown(cache: FakeCache): Promise<void> {
  await cache.delete(COOLDOWN_KEY);
}

async function attemptWith(service: OtpService, code: string) {
  return service.verify({ ...input, code }).then(
    () => "ok" as const,
    (error: unknown) => error,
  );
}

describe("OtpService", () => {
  describe("issue", () => {
    it("stores a keyed hash and no copy of the code", async () => {
      const { service, cache } = createService();

      const issued = await service.issue({
        ...input,
        subject: "User@Example.com",
      });

      expect(issued).toEqual({
        code: expect.stringMatching(/^\d{6}$/),
        ttlInSeconds: 600,
        resendAvailableInSeconds: 60,
      });
      expect(await cache.getJson(OTP_KEY)).toEqual({
        codeHash: createHmac("sha256", HASH_SECRET)
          .update(`${PURPOSE}|${SUBJECT}|${issued.code}`)
          .digest("base64url"),
      });
      expect([...cache.entries.keys()].sort()).toEqual(
        [ATTEMPTS_KEY, COOLDOWN_KEY, OTP_KEY].sort(),
      );
      for (const { value } of cache.entries.values()) {
        expect(value).not.toContain(issued.code);
      }
    });

    it("starts the attempt count and cooldown with the configured lifetimes", async () => {
      const { service, cache } = createService({
        ttlInSeconds: 300,
        resendCooldownInSeconds: 45,
      });

      await service.issue(input);

      expect(cache.entries.get(OTP_KEY)?.ttl).toBe(300);
      expect(cache.entries.get(ATTEMPTS_KEY)).toEqual({ value: "0", ttl: 300 });
      expect(cache.entries.get(COOLDOWN_KEY)).toEqual({ value: "1", ttl: 45 });
      expect(service.getTtlInSeconds()).toBe(300);
    });

    it("rejects a resend while the cooldown is active", async () => {
      const { service, cache } = createService();
      await cache.set(COOLDOWN_KEY, "1", 23);

      await expect(service.issue(input)).rejects.toMatchObject<
        Partial<TooManyRequestError>
      >({
        message: "A verification code was sent recently.",
        details: { retryAfterSeconds: 23 },
      });
    });

    it("keeps the attempt count across a resend and re-arms its expiry", async () => {
      const { service, cache } = createService({ maxAttempts: 5 });
      const first = await service.issue(input);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await attemptWith(service, wrongCodeFor(first.code));
      }
      cache.entries.get(ATTEMPTS_KEY)!.ttl = 30;
      await endCooldown(cache);
      const second = await service.issue(input);

      expect(cache.entries.get(ATTEMPTS_KEY)).toEqual({ value: "3", ttl: 600 });
      await expect(
        service.verify({ ...input, code: wrongCodeFor(second.code) }),
      ).rejects.toMatchObject({ details: { attemptsRemaining: 1 } });
    });

    it("refuses a new code once the budget is spent, until it expires", async () => {
      const { service, cache } = createService({ maxAttempts: 2 });
      const issued = await service.issue(input);
      await attemptWith(service, wrongCodeFor(issued.code));
      await attemptWith(service, wrongCodeFor(issued.code));
      await endCooldown(cache);
      cache.entries.get(ATTEMPTS_KEY)!.ttl = 412;

      await expect(service.issue(input)).rejects.toMatchObject<
        Partial<TooManyRequestError>
      >({
        message: "Too many incorrect codes. Try again later.",
        details: {
          retryAfterSeconds: 412,
          reason: OTP_ATTEMPTS_EXHAUSTED_REASON,
        },
      });
      // A refusal must not extend the window it is waiting out.
      expect(cache.entries.get(ATTEMPTS_KEY)?.ttl).toBe(412);

      await cache.delete(ATTEMPTS_KEY);
      const fresh = await service.issue(input);
      await expect(
        service.verify({ ...input, code: fresh.code }),
      ).resolves.toBeUndefined();
    });

    it("treats an unreadable attempt count as unused", async () => {
      const { service, cache } = createService();
      await cache.set(ATTEMPTS_KEY, "not-a-number", 600);

      await expect(service.issue(input)).resolves.toMatchObject({
        code: expect.any(String),
      });
    });
  });

  describe("verify", () => {
    it("accepts the code once, trimmed and for any subject casing, and clears its keys", async () => {
      const { service, cache } = createService({ previewEnabled: true });
      const issued = await service.issue(input);

      await expect(
        service.verify({
          ...input,
          subject: "USER@example.com",
          code: ` ${issued.code} `,
        }),
      ).resolves.toBeUndefined();

      expect(cache.entries.size).toBe(0);
      await expect(
        service.verify({ ...input, code: issued.code }),
      ).rejects.toMatchObject({
        message: "Verification code is invalid or has expired.",
      });
    });

    it("runs the hook only for the right code, before spending it", async () => {
      const { service, cache } = createService();
      const issued = await service.issue(input);
      const beforeConsume = jest.fn(async () => {
        expect(cache.entries.has(OTP_KEY)).toBe(true);
      });

      await expect(
        service.verify({
          ...input,
          code: wrongCodeFor(issued.code),
          beforeConsume,
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(beforeConsume).not.toHaveBeenCalled();

      await expect(
        service.verify({ ...input, code: issued.code, beforeConsume }),
      ).resolves.toBeUndefined();
      expect(beforeConsume).toHaveBeenCalledTimes(1);
      expect(cache.entries.has(OTP_KEY)).toBe(false);
    });

    it("keeps the code valid when the hook refuses, but counts the attempt", async () => {
      const { service, cache } = createService();
      const issued = await service.issue(input);
      const refusal = new Error("password refused");

      await expect(
        service.verify({
          ...input,
          code: issued.code,
          beforeConsume: async () => {
            throw refusal;
          },
        }),
      ).rejects.toBe(refusal);

      expect(cache.entries.has(OTP_KEY)).toBe(true);
      expect(cache.entries.get(ATTEMPTS_KEY)?.value).toBe("1");
      await expect(
        service.verify({ ...input, code: issued.code }),
      ).resolves.toBeUndefined();
    });

    it("counts a wrong code and keeps the code alive", async () => {
      const { service, cache } = createService();
      const issued = await service.issue(input);

      await expect(
        service.verify({ ...input, code: wrongCodeFor(issued.code) }),
      ).rejects.toMatchObject<Partial<BadRequestError>>({
        message: "Verification code is invalid.",
        details: { attemptsRemaining: 4 },
      });

      expect(cache.entries.get(ATTEMPTS_KEY)?.value).toBe("1");
      expect(cache.entries.has(OTP_KEY)).toBe(true);
      await expect(
        service.verify({ ...input, code: issued.code }),
      ).resolves.toBeUndefined();
    });

    it("discards the code on the last wrong attempt but keeps the count", async () => {
      const { service, cache } = createService({
        maxAttempts: 2,
        previewEnabled: true,
      });
      const issued = await service.issue(input);
      await attemptWith(service, wrongCodeFor(issued.code));

      await expect(
        service.verify({ ...input, code: wrongCodeFor(issued.code) }),
      ).rejects.toMatchObject({ details: { attemptsRemaining: 0 } });

      expect(cache.entries.has(OTP_KEY)).toBe(false);
      expect(cache.entries.has(PREVIEW_KEY)).toBe(false);
      expect(cache.entries.get(ATTEMPTS_KEY)?.value).toBe("2");
      await expect(
        service.verify({ ...input, code: issued.code }),
      ).rejects.toMatchObject({
        message: "Verification code is invalid or has expired.",
      });
    });

    it("spends an attempt before comparing, so concurrent guesses cannot overrun the budget", async () => {
      const { service, cache } = createService({ maxAttempts: 5 });
      const issued = await service.issue(input);
      const wrong = wrongCodeFor(issued.code);

      const results = await Promise.all(
        Array.from({ length: 7 }, () => attemptWith(service, wrong)),
      );

      expect(
        results
          .map(
            (error) =>
              (error as BadRequestError).details as {
                attemptsRemaining: number;
              },
          )
          .map((details) => details.attemptsRemaining)
          .sort(),
      ).toEqual([0, 0, 0, 1, 2, 3, 4]);
      expect(cache.entries.get(ATTEMPTS_KEY)?.value).toBe("7");
      await expect(attemptWith(service, issued.code)).resolves.toBeInstanceOf(
        BadRequestError,
      );
    });

    it("refuses the right code once the budget is spent, even if the code is still stored", async () => {
      const { service, cache } = createService({ maxAttempts: 1 });
      const issued = await service.issue(input);
      await cache.set(ATTEMPTS_KEY, "1", 600);

      await expect(
        service.verify({ ...input, code: issued.code }),
      ).rejects.toMatchObject({
        message: "Verification code is invalid.",
        details: { attemptsRemaining: 0 },
      });
      expect(cache.entries.has(OTP_KEY)).toBe(false);
    });

    it("lets only the request whose delete removed the code use it", async () => {
      const { service, cache } = createService();
      const issued = await service.issue(input);
      jest.spyOn(cache, "delete").mockResolvedValueOnce(false);

      await expect(
        service.verify({ ...input, code: issued.code }),
      ).rejects.toMatchObject({
        message: "Verification code is invalid or has expired.",
      });
    });

    it("gives a recreated attempt count an expiry", async () => {
      const { service, cache } = createService({ ttlInSeconds: 300 });
      const issued = await service.issue(input);
      await cache.delete(ATTEMPTS_KEY);

      await attemptWith(service, wrongCodeFor(issued.code));

      expect(cache.entries.get(ATTEMPTS_KEY)).toEqual({ value: "1", ttl: 300 });
    });

    it("binds the hash to its purpose and subject", async () => {
      const { service, cache } = createService();
      const issued = await service.issue(input);
      const otherKey = "auth:otp:password-reset:user@example.com";
      await cache.set(otherKey, cache.entries.get(OTP_KEY)!.value, 600);

      await expect(
        service.verify({
          purpose: "password-reset",
          subject: SUBJECT,
          code: issued.code,
        }),
      ).rejects.toMatchObject({ message: "Verification code is invalid." });
    });

    it("refuses and removes a plaintext record issued before hashing", async () => {
      const { service, cache } = createService();
      await cache.setJson(
        OTP_KEY,
        { code: "123456", attemptsRemaining: 5 },
        300,
      );

      await expect(
        service.verify({ ...input, code: "123456" }),
      ).rejects.toMatchObject({
        message: "Verification code is invalid or has expired.",
      });
      expect(cache.entries.has(OTP_KEY)).toBe(false);
    });

    it("rejects a missing or expired code", async () => {
      const { service } = createService();

      await expect(
        service.verify({ ...input, subject: "missing@example.com", code: "1" }),
      ).rejects.toMatchObject({
        message: "Verification code is invalid or has expired.",
      });
    });

    it("rejects a stored hash of the wrong length", async () => {
      const { service, cache } = createService();
      await cache.setJson(OTP_KEY, { codeHash: "c2hvcnQ" }, 300);

      await expect(
        service.verify({ ...input, code: "123456" }),
      ).rejects.toMatchObject({ details: { attemptsRemaining: 4 } });
    });
  });

  describe("peek", () => {
    it("has nothing to read back when previews are off", async () => {
      const { service, cache } = createService();
      await service.issue(input);

      await expect(service.peek(input)).resolves.toBeNull();
      expect(cache.entries.has(PREVIEW_KEY)).toBe(false);
    });

    it("reads the code from its own namespace while the code is live", async () => {
      const { service, cache } = createService({ previewEnabled: true });
      const issued = await service.issue(input);
      cache.entries.get(OTP_KEY)!.ttl = 540;

      await expect(service.peek(input)).resolves.toEqual({
        code: issued.code,
        expiresInSeconds: 540,
      });
      for (const [key, { value }] of cache.entries) {
        if (key !== PREVIEW_KEY) {
          expect(value).not.toContain(issued.code);
        }
      }
    });

    it("returns nothing once the code is gone", async () => {
      const { service, cache } = createService({ previewEnabled: true });
      await service.issue(input);
      await cache.delete(OTP_KEY);

      await expect(service.peek(input)).resolves.toBeNull();
      await expect(
        service.peek({ purpose: "other", subject: SUBJECT }),
      ).resolves.toBeNull();
    });
  });
});
