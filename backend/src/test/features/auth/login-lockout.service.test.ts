import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { LoginLockoutService } from "@/features/auth/lockout/login-lockout.service";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";

function createClient(): ClientRequestContext {
  return {
    ip: "203.0.113.10",
    device: { id: "device-1", type: "desktop", isMobile: false },
  } as ClientRequestContext;
}

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: "user-1",
    email: "user@example.com",
    passwordHash: "",
    tokenVersion: 1,
    firstName: "Test",
    role: "user",
    emailVerified: true,
    oauthIdentities: [],
    organizationMemberships: [],
    profile: {
      id: "profile-1",
      userId: "user-1",
      username: "test-user",
      isPrivate: false,
      recommendationPersonalizationEnabled: true,
      trustworthinessScore: 80,
      rentPostingsCount: 0,
      availableRentPostingsCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const LOCK_KEY = "auth:local-login-attempts:test-user";

function createHarness() {
  const store = new Map<string, unknown>();
  const ttls = new Map<string, number | undefined>();
  const cacheService = {
    getJson: jest.fn(async (key: string) => store.get(key) ?? null),
    setJson: jest.fn(async (key: string, value: unknown, ttl?: number) => {
      store.set(key, value);
      ttls.set(key, ttl);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  const authRepository = {
    findUserByEmail: jest.fn(async () => null as AuthUserRecord | null),
  };
  const otpService = {
    verify: jest.fn(async () => undefined),
    issue: jest.fn(async () => ({ code: "654321", ttlInSeconds: 600 })),
  };
  const emailService = {
    sendLoginUnlockEmail: jest.fn(async () => undefined),
  };
  const publicOtpService = new PublicOtpService(
    cacheService as never,
    otpService as never,
    emailService as never,
  );

  return {
    store,
    ttls,
    cacheService,
    authRepository,
    otpService,
    emailService,
    service: new LoginLockoutService(
      cacheService as never,
      authRepository as never,
      otpService as never,
      publicOtpService,
    ),
  };
}

describe("LoginLockoutService attempt tracking", () => {
  it("counts a first failure without locking", async () => {
    const harness = createHarness();

    await expect(
      harness.service.recordFailedAttempt("Test-User"),
    ).resolves.toEqual({ failedAttempts: 1 });
    expect(harness.ttls.get(LOCK_KEY)).toBe(15 * 60);
  });

  it("normalizes the username into the cache key", async () => {
    const harness = createHarness();

    await harness.service.recordFailedAttempt("TEST-USER");

    expect(harness.cacheService.setJson).toHaveBeenCalledWith(
      LOCK_KEY,
      expect.anything(),
      expect.anything(),
    );
  });

  it("locks on the fifth failure and switches to the lock TTL", async () => {
    const harness = createHarness();
    harness.store.set(LOCK_KEY, { failedAttempts: 4 });

    const record = await harness.service.recordFailedAttempt("test-user");

    expect(record.failedAttempts).toBe(5);
    expect(record.lockedAt).toEqual(expect.any(String));
    expect(harness.ttls.get(LOCK_KEY)).toBe(30 * 60);
  });

  it("reports the lock state", async () => {
    const harness = createHarness();

    await expect(harness.service.isLocked("test-user")).resolves.toBe(false);

    harness.store.set(LOCK_KEY, { failedAttempts: 5, lockedAt: "2026-01-02" });

    await expect(harness.service.isLocked("test-user")).resolves.toBe(true);
  });

  it("does not treat counted-but-unlocked attempts as locked", async () => {
    const harness = createHarness();
    harness.store.set(LOCK_KEY, { failedAttempts: 3 });

    await expect(harness.service.isLocked("test-user")).resolves.toBe(false);
  });

  it("clears the record", async () => {
    const harness = createHarness();
    harness.store.set(LOCK_KEY, { failedAttempts: 5, lockedAt: "2026-01-02" });

    await harness.service.clearAttemptRecord("test-user");

    expect(harness.store.has(LOCK_KEY)).toBe(false);
  });
});

describe("LoginLockoutService.buildLockedLoginDetails", () => {
  it("includes the email when the account exists", () => {
    expect(
      createHarness().service.buildLockedLoginDetails(createUser()),
    ).toEqual({ email: "user@example.com", unlockRequired: true });
  });

  it("reveals nothing for an unknown username", () => {
    expect(createHarness().service.buildLockedLoginDetails(null)).toEqual({
      unlockRequired: true,
    });
  });
});

describe("LoginLockoutService.unlockLocalLogin", () => {
  it("verifies the code and clears the lock for a known account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByEmail.mockResolvedValue(createUser());
    harness.store.set(LOCK_KEY, { failedAttempts: 5, lockedAt: "2026-01-02" });

    await expect(
      harness.service.unlockLocalLogin({
        email: "user@example.com",
        code: "123456",
      }),
    ).resolves.toEqual({ unlocked: true, email: "user@example.com" });

    expect(harness.otpService.verify).toHaveBeenCalledWith({
      purpose: "local-login-unlock",
      subject: "user@example.com",
      code: "123456",
    });
    expect(harness.store.has(LOCK_KEY)).toBe(false);
  });

  it("reports success for an unknown address once the code checks out", async () => {
    const harness = createHarness();

    await expect(
      harness.service.unlockLocalLogin({
        email: "nobody@example.com",
        code: "123456",
      }),
    ).resolves.toEqual({ unlocked: true, email: "nobody@example.com" });
    expect(harness.cacheService.delete).not.toHaveBeenCalled();
  });

  it("propagates an invalid code", async () => {
    const harness = createHarness();
    harness.otpService.verify.mockRejectedValue(new Error("Invalid code."));

    await expect(
      harness.service.unlockLocalLogin({
        email: "user@example.com",
        code: "000000",
      }),
    ).rejects.toThrow("Invalid code.");
  });
});

describe("LoginLockoutService.resendUnlockLocalLogin", () => {
  it("sends a code while the account is locked", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByEmail.mockResolvedValue(createUser());
    harness.store.set(LOCK_KEY, { failedAttempts: 5, lockedAt: "2026-01-02" });

    await expect(
      harness.service.resendUnlockLocalLogin({
        client: createClient(),
        email: "user@example.com",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({ accepted: true });

    expect(harness.emailService.sendLoginUnlockEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      unlockCode: "654321",
      firstName: "Test",
    });
  });

  it("sends nothing when the account is not locked", async () => {
    // Otherwise the endpoint would mail anybody on demand.
    const harness = createHarness();
    harness.authRepository.findUserByEmail.mockResolvedValue(createUser());

    await expect(
      harness.service.resendUnlockLocalLogin({
        client: createClient(),
        email: "user@example.com",
      }),
    ).resolves.toEqual({ accepted: true });
    expect(harness.emailService.sendLoginUnlockEmail).not.toHaveBeenCalled();
  });

  it("accepts an unknown address without sending anything", async () => {
    const harness = createHarness();

    await expect(
      harness.service.resendUnlockLocalLogin({
        client: createClient(),
        email: "nobody@example.com",
      }),
    ).resolves.toEqual({ accepted: true });
    expect(harness.emailService.sendLoginUnlockEmail).not.toHaveBeenCalled();
  });

  it("still reports acceptance when rate limited", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByEmail.mockResolvedValue(createUser());
    harness.store.set(LOCK_KEY, { failedAttempts: 5, lockedAt: "2026-01-02" });
    harness.store.set(
      "auth:otp-rate:local-login-unlock:email:user@example.com",
      {
        count: 5,
      },
    );

    await expect(
      harness.service.resendUnlockLocalLogin({
        client: createClient(),
        email: "user@example.com",
      }),
    ).resolves.toEqual({ accepted: true });
    expect(harness.emailService.sendLoginUnlockEmail).not.toHaveBeenCalled();
  });
});
