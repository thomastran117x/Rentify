import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";

function createClient(): ClientRequestContext {
  return {
    ip: "203.0.113.10",
    device: { id: "device-1", type: "desktop", isMobile: false },
  } as ClientRequestContext;
}

function createUser(): AuthUserRecord {
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
  };
}

const cooldownError = Object.assign(new Error("Cooldown"), {
  name: "TooManyRequestError",
});

function createHarness() {
  const store = new Map<string, unknown>();
  const cacheService = {
    getJson: jest.fn(async (key: string) => store.get(key) ?? null),
    setJson: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  const otpService = {
    issue: jest.fn(async () => ({ code: "123456", ttlInSeconds: 600 })),
  };
  const emailService = {
    sendVerificationEmail: jest.fn(async () => undefined),
    sendPasswordResetEmail: jest.fn(async () => undefined),
    sendUsernameReminderEmail: jest.fn(async () => undefined),
    sendLoginUnlockEmail: jest.fn(async () => undefined),
  };

  return {
    store,
    cacheService,
    otpService,
    emailService,
    service: new PublicOtpService(
      cacheService as never,
      otpService as never,
      emailService as never,
    ),
  };
}

describe("PublicOtpService.consumeRateLimit", () => {
  it("allows a first request and counts it against email, ip and device", async () => {
    const harness = createHarness();

    const result = await harness.service.consumeRateLimit({
      purpose: "local-password-reset",
      subject: "User@Example.com",
      client: createClient(),
      flow: "forgot-password",
    });

    expect(result).toEqual({
      allowed: true,
      flow: "forgot-password",
      purpose: "local-password-reset",
      subject: "User@Example.com",
    });
    expect([...harness.store.keys()]).toEqual([
      "auth:otp-rate:local-password-reset:email:user@example.com",
      "auth:otp-rate:local-password-reset:ip:203.0.113.10",
      "auth:otp-rate:local-password-reset:device:device-1",
    ]);
  });

  it("denies once the per-email limit is reached", async () => {
    const harness = createHarness();
    harness.store.set(
      "auth:otp-rate:local-password-reset:email:user@example.com",
      { count: 5 },
    );

    await expect(
      harness.service.consumeRateLimit({
        purpose: "local-password-reset",
        subject: "user@example.com",
        client: createClient(),
        flow: "forgot-password",
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "email-rate-limit",
      scope: "email",
    });
  });

  it("denies once the per-ip limit is reached", async () => {
    const harness = createHarness();
    harness.store.set("auth:otp-rate:username-reminder:ip:203.0.113.10", {
      count: 20,
    });

    await expect(
      harness.service.consumeRateLimit({
        purpose: "username-reminder",
        subject: "user@example.com",
        client: createClient(),
        flow: "forgot-username",
      }),
    ).resolves.toMatchObject({ allowed: false, scope: "ip" });
  });

  it("denies once the per-device limit is reached", async () => {
    const harness = createHarness();
    harness.store.set("auth:otp-rate:email-verification:device:device-2", {
      count: 10,
    });

    await expect(
      harness.service.consumeRateLimit({
        purpose: "email-verification",
        subject: "user@example.com",
        client: createClient(),
        deviceId: "device-2",
        flow: "resend-verification-email",
      }),
    ).resolves.toMatchObject({ allowed: false, scope: "device" });
  });

  it("skips a scope with no value to count", async () => {
    const harness = createHarness();

    await harness.service.consumeRateLimit({
      purpose: "email-verification",
      subject: "user@example.com",
      client: {
        ip: undefined,
        device: { id: undefined },
      } as unknown as ClientRequestContext,
      flow: "resend-verification-email",
    });

    expect([...harness.store.keys()]).toEqual([
      "auth:otp-rate:email-verification:email:user@example.com",
    ]);
  });

  it("increments an existing count rather than resetting it", async () => {
    const harness = createHarness();
    harness.store.set(
      "auth:otp-rate:local-password-reset:email:user@example.com",
      { count: 2 },
    );

    await harness.service.consumeRateLimit({
      purpose: "local-password-reset",
      subject: "user@example.com",
      client: createClient(),
      flow: "forgot-password",
    });

    expect(
      harness.store.get(
        "auth:otp-rate:local-password-reset:email:user@example.com",
      ),
    ).toEqual({ count: 3 });
  });
});

describe("PublicOtpService email delivery", () => {
  it("sends a verification code with the TTL in whole minutes", async () => {
    const harness = createHarness();

    await harness.service.sendEmailVerificationCode({
      email: "user@example.com",
      firstName: "Test",
    });

    expect(harness.emailService.sendVerificationEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      verificationCode: "123456",
      firstName: "Test",
      expiresInMinutes: 10,
    });
  });

  it("propagates a non-cooldown failure from the verification send", async () => {
    const harness = createHarness();
    harness.otpService.issue.mockRejectedValueOnce(new Error("redis down"));

    await expect(
      harness.service.sendEmailVerificationCode({ email: "user@example.com" }),
    ).rejects.toThrow("redis down");
  });

  it("sends a password reset code", async () => {
    const harness = createHarness();

    await harness.service.sendPasswordResetCode(createUser());

    expect(harness.emailService.sendPasswordResetEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      resetCode: "123456",
      firstName: "Test",
      expiresInMinutes: 10,
    });
  });

  it("sends a username reminder without issuing a code", async () => {
    const harness = createHarness();

    await harness.service.sendUsernameReminder(createUser());

    expect(harness.otpService.issue).not.toHaveBeenCalled();
    expect(harness.emailService.sendUsernameReminderEmail).toHaveBeenCalledWith(
      {
        to: "user@example.com",
        username: "test-user",
        firstName: "Test",
      },
    );
  });

  it("sends a login unlock code", async () => {
    const harness = createHarness();

    await harness.service.sendLoginUnlockCode(createUser());

    expect(harness.emailService.sendLoginUnlockEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      unlockCode: "123456",
      firstName: "Test",
    });
  });

  it("does nothing when there is no account to unlock", async () => {
    const harness = createHarness();

    await expect(
      harness.service.sendLoginUnlockCode(null),
    ).resolves.toBeUndefined();
    expect(harness.otpService.issue).not.toHaveBeenCalled();
  });
});

describe("PublicOtpService cooldown swallowing", () => {
  // These endpoints answer identically whether or not the account exists. A
  // cooldown surfacing as an error would tell a caller the address is real, so
  // it is swallowed and logged instead.
  it("swallows a cooldown on public verification resend", async () => {
    const harness = createHarness();
    harness.otpService.issue.mockRejectedValueOnce(cooldownError);

    await expect(
      harness.service.sendPublicEmailVerificationCode({
        email: "user@example.com",
        firstName: "Test",
      }),
    ).resolves.toBeUndefined();
  });

  it("propagates a non-cooldown failure on public verification resend", async () => {
    const harness = createHarness();
    harness.otpService.issue.mockRejectedValueOnce(new Error("redis down"));

    await expect(
      harness.service.sendPublicEmailVerificationCode({
        email: "user@example.com",
      }),
    ).rejects.toThrow("redis down");
  });

  it("swallows a cooldown on password reset", async () => {
    const harness = createHarness();
    harness.otpService.issue.mockRejectedValueOnce(cooldownError);

    await expect(
      harness.service.sendPasswordResetCode(createUser()),
    ).resolves.toBeUndefined();
  });

  it("propagates a non-cooldown failure on password reset", async () => {
    const harness = createHarness();
    harness.otpService.issue.mockRejectedValueOnce(new Error("redis down"));

    await expect(
      harness.service.sendPasswordResetCode(createUser()),
    ).rejects.toThrow("redis down");
  });

  it("swallows a cooldown on login unlock", async () => {
    const harness = createHarness();
    harness.otpService.issue.mockRejectedValueOnce(cooldownError);

    await expect(
      harness.service.sendLoginUnlockCode(createUser()),
    ).resolves.toBeUndefined();
  });

  it("propagates a non-cooldown failure on login unlock", async () => {
    const harness = createHarness();
    harness.otpService.issue.mockRejectedValueOnce(new Error("redis down"));

    await expect(
      harness.service.sendLoginUnlockCode(createUser()),
    ).rejects.toThrow("redis down");
  });
});
