import BadRequestError from "@/errors/http/bad-request.error";
import TooManyRequestError from "@/errors/http/too-many-request.error";
import { OtpService } from "@/features/auth/otp/otp.service";

function createCache() {
  const jsonStore = new Map<string, { value: unknown; ttlSeconds: number }>();
  const valueStore = new Map<string, { value: string; ttlSeconds: number }>();

  return {
    jsonStore,
    valueStore,
    service: {
      getJson: jest.fn(async <TValue>(key: string) => {
        return (jsonStore.get(key)?.value as TValue | undefined) ?? null;
      }),
      setJson: jest.fn(
        async (key: string, value: unknown, ttlSeconds: number) => {
          jsonStore.set(key, {
            value,
            ttlSeconds,
          });
        },
      ),
      set: jest.fn(async (key: string, value: string, ttlSeconds: number) => {
        valueStore.set(key, {
          value,
          ttlSeconds,
        });
      }),
      ttl: jest.fn(async (key: string) => {
        const jsonTtl = jsonStore.get(key)?.ttlSeconds;
        const valueTtl = valueStore.get(key)?.ttlSeconds;
        return jsonTtl ?? valueTtl ?? -1;
      }),
      delete: jest.fn(async (key: string) => {
        const deletedJson = jsonStore.delete(key);
        const deletedValue = valueStore.delete(key);
        return deletedJson || deletedValue;
      }),
    },
  };
}

function createService(options?: {
  codeLength?: number;
  ttlInSeconds?: number;
  resendCooldownInSeconds?: number;
  maxAttempts?: number;
  cachePrefix?: string;
}) {
  const cache = createCache();
  const service = new OtpService({
    cache: cache.service as any,
    codeLength: options?.codeLength,
    ttlInSeconds: options?.ttlInSeconds,
    resendCooldownInSeconds: options?.resendCooldownInSeconds,
    maxAttempts: options?.maxAttempts,
    cachePrefix: options?.cachePrefix,
  });

  return {
    service,
    cache,
  };
}

describe("OtpService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("issues a code, stores it with the configured TTL, and creates a resend cooldown", async () => {
    const { service, cache } = createService({
      ttlInSeconds: 300,
      resendCooldownInSeconds: 45,
      maxAttempts: 4,
      cachePrefix: "test:otp",
    });

    const issued = await service.issue({
      purpose: "verify-email",
      subject: "User@Example.com",
    });

    expect(issued).toEqual({
      code: expect.stringMatching(/^\d{6}$/),
      ttlInSeconds: 300,
      resendAvailableInSeconds: 45,
    });
    expect(cache.service.setJson).toHaveBeenCalledWith(
      "test:otp:verify-email:user@example.com",
      {
        code: issued.code,
        attemptsRemaining: 4,
      },
      300,
    );
    expect(cache.service.set).toHaveBeenCalledWith(
      "test:otp:verify-email:user@example.com:cooldown",
      "1",
      45,
    );
  });

  it("rejects re-issuing a code while the resend cooldown is active", async () => {
    const { service, cache } = createService({
      resendCooldownInSeconds: 60,
    });

    cache.valueStore.set("auth:otp:verify-email:user@example.com:cooldown", {
      value: "1",
      ttlSeconds: 23,
    });

    await expect(
      service.issue({
        purpose: "verify-email",
        subject: "user@example.com",
      }),
    ).rejects.toMatchObject<Partial<TooManyRequestError>>({
      message: "A verification code was sent recently.",
      details: {
        retryAfterSeconds: 23,
      },
    });
  });

  it("verifies a correct code after trimming whitespace and removes the otp and cooldown", async () => {
    const { service, cache } = createService({
      cachePrefix: "test:otp",
    });

    cache.jsonStore.set("test:otp:password-reset:user@example.com", {
      value: {
        code: "123456",
        attemptsRemaining: 5,
      },
      ttlSeconds: 300,
    });
    cache.valueStore.set("test:otp:password-reset:user@example.com:cooldown", {
      value: "1",
      ttlSeconds: 40,
    });

    await expect(
      service.verify({
        purpose: "password-reset",
        subject: "USER@example.com",
        code: " 123456 ",
      }),
    ).resolves.toBeUndefined();

    expect(cache.service.delete).toHaveBeenCalledWith(
      "test:otp:password-reset:user@example.com",
    );
    expect(cache.service.delete).toHaveBeenCalledWith(
      "test:otp:password-reset:user@example.com:cooldown",
    );
  });

  it("decrements remaining attempts and preserves ttl when verification fails", async () => {
    const { service, cache } = createService({
      cachePrefix: "test:otp",
    });

    cache.jsonStore.set("test:otp:unlock:user@example.com", {
      value: {
        code: "654321",
        attemptsRemaining: 3,
      },
      ttlSeconds: 87,
    });

    await expect(
      service.verify({
        purpose: "unlock",
        subject: "user@example.com",
        code: "111111",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Verification code is invalid.",
      details: {
        attemptsRemaining: 2,
      },
    });

    expect(cache.service.setJson).toHaveBeenCalledWith(
      "test:otp:unlock:user@example.com",
      {
        code: "654321",
        attemptsRemaining: 2,
      },
      87,
    );
  });

  it("deletes the otp record when the final verification attempt fails", async () => {
    const { service, cache } = createService({
      cachePrefix: "test:otp",
    });

    cache.jsonStore.set("test:otp:unlock:user@example.com", {
      value: {
        code: "654321",
        attemptsRemaining: 1,
      },
      ttlSeconds: 90,
    });

    await expect(
      service.verify({
        purpose: "unlock",
        subject: "user@example.com",
        code: "000000",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Verification code is invalid.",
      details: {
        attemptsRemaining: 0,
      },
    });

    expect(cache.service.delete).toHaveBeenCalledWith(
      "test:otp:unlock:user@example.com",
    );
  });

  it("deletes the otp record when a failed verification finds no remaining ttl", async () => {
    const { service, cache } = createService({
      cachePrefix: "test:otp",
    });

    cache.jsonStore.set("test:otp:unlock:user@example.com", {
      value: {
        code: "654321",
        attemptsRemaining: 4,
      },
      ttlSeconds: 0,
    });

    await expect(
      service.verify({
        purpose: "unlock",
        subject: "user@example.com",
        code: "999999",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Verification code is invalid.",
      details: {
        attemptsRemaining: 3,
      },
    });

    expect(cache.service.delete).toHaveBeenCalledWith(
      "test:otp:unlock:user@example.com",
    );
  });

  it("rejects verification when the code is missing or expired", async () => {
    const { service } = createService();

    await expect(
      service.verify({
        purpose: "verify-email",
        subject: "missing@example.com",
        code: "123456",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Verification code is invalid or has expired.",
    });
  });
});
