import type { ClientRequestContext } from "@/configuration/http/bindings";
import ConflictError from "@/errors/http/conflict.error";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";
import { PendingSignupStore } from "@/features/auth/pending-signup/pending-signup.store";
import { UsernameService } from "@/features/auth/username/username.service";

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
    acquireLock: jest.fn(async () => ({ release: jest.fn() })),
  };
  const authRepository = {
    findUserIdByUsername: jest.fn(async () => null as string | null),
    findUserByEmail: jest.fn(async () => null as AuthUserRecord | null),
  };
  const usernameBloomService = {
    check: jest.fn(() => "possibly-present" as string),
    add: jest.fn(async () => undefined),
  };
  const otpService = {
    issue: jest.fn(async () => ({ code: "123456", ttlInSeconds: 600 })),
  };
  const emailService = {
    sendUsernameReminderEmail: jest.fn(async () => undefined),
  };
  const pendingSignupStore = new PendingSignupStore(
    cacheService as never,
    usernameBloomService as never,
  );
  const publicOtpService = new PublicOtpService(
    cacheService as never,
    otpService as never,
    emailService as never,
  );

  return {
    store,
    cacheService,
    authRepository,
    usernameBloomService,
    emailService,
    pendingSignupStore,
    service: new UsernameService(
      authRepository as never,
      usernameBloomService as never,
      pendingSignupStore,
      publicOtpService,
    ),
  };
}

async function reserve(
  harness: ReturnType<typeof createHarness>,
  username: string,
  email: string,
) {
  await harness.pendingSignupStore.write(
    {
      username,
      email,
      passwordHash: "$2b$12$hash",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    600,
  );
}

describe("UsernameService.isUsernameAvailable", () => {
  it("reports an unused username as available and normalizes it", async () => {
    const harness = createHarness();

    await expect(
      harness.service.isUsernameAvailable("  Casey-Doe  "),
    ).resolves.toEqual({
      username: "casey-doe",
      available: true,
      reason: null,
    });
  });

  it("reports a username held by another account as taken", async () => {
    const harness = createHarness();
    harness.authRepository.findUserIdByUsername.mockResolvedValue("user-2");

    await expect(
      harness.service.isUsernameAvailable("casey-doe"),
    ).resolves.toEqual({
      username: "casey-doe",
      available: false,
      reason: "taken",
    });
  });

  it("exempts the caller's own username so settings does not flag it", async () => {
    const harness = createHarness();
    harness.authRepository.findUserIdByUsername.mockResolvedValue("user-1");

    await expect(
      harness.service.isUsernameAvailable("casey-doe", "user-1"),
    ).resolves.toMatchObject({ available: true, reason: null });
  });

  it("reports a username reserved by an unverified signup as taken", async () => {
    const harness = createHarness();
    await reserve(harness, "casey-doe", "pending@example.com");

    await expect(
      harness.service.isUsernameAvailable("casey-doe"),
    ).resolves.toMatchObject({ available: false, reason: "taken" });
  });

  it("exempts the pending signup's own email from its reservation", async () => {
    const harness = createHarness();
    await reserve(harness, "casey-doe", "pending@example.com");

    await expect(
      harness.service.isUsernameAvailable(
        "casey-doe",
        undefined,
        "pending@example.com",
      ),
    ).resolves.toMatchObject({ available: true });
  });

  it("always consults the database, even when the filter has an opinion", async () => {
    // Write paths call this method. Letting the filter short-circuit them would
    // trade a clear "that username is taken" for a unique-constraint violation
    // surfaced later.
    const harness = createHarness();
    harness.usernameBloomService.check.mockReturnValue("definitely-absent");

    await harness.service.isUsernameAvailable("casey-doe");

    expect(harness.authRepository.findUserIdByUsername).toHaveBeenCalledWith(
      "casey-doe",
    );
  });
});

describe("UsernameService.resolveUsernameAvailabilityHint", () => {
  it("answers from the filter without touching the database", async () => {
    const harness = createHarness();
    harness.usernameBloomService.check.mockReturnValue("definitely-absent");

    await expect(
      harness.service.resolveUsernameAvailabilityHint("  Casey-Doe  "),
    ).resolves.toEqual({
      username: "casey-doe",
      available: true,
      reason: null,
    });
    expect(harness.authRepository.findUserIdByUsername).not.toHaveBeenCalled();
  });

  it("normalizes before consulting the filter", async () => {
    const harness = createHarness();
    harness.usernameBloomService.check.mockReturnValue("definitely-absent");

    await harness.service.resolveUsernameAvailabilityHint("  Casey-Doe  ");

    expect(harness.usernameBloomService.check).toHaveBeenCalledWith(
      "casey-doe",
    );
  });

  it("falls through to the database when the filter cannot rule the name out", async () => {
    // A false positive has to stay correct: it costs one query and still
    // returns the right verdict.
    const harness = createHarness();
    harness.authRepository.findUserIdByUsername.mockResolvedValue("user-2");

    await expect(
      harness.service.resolveUsernameAvailabilityHint("casey-doe"),
    ).resolves.toEqual({
      username: "casey-doe",
      available: false,
      reason: "taken",
    });
    expect(harness.authRepository.findUserIdByUsername).toHaveBeenCalledWith(
      "casey-doe",
    );
  });

  it("returns available when the filter was wrong and the row does not exist", async () => {
    const harness = createHarness();

    await expect(
      harness.service.resolveUsernameAvailabilityHint("casey-doe"),
    ).resolves.toMatchObject({ available: true, reason: null });
  });

  it("reproduces the old behaviour when the filter is unavailable", async () => {
    const harness = createHarness();
    harness.usernameBloomService.check.mockReturnValue("unknown");
    harness.authRepository.findUserIdByUsername.mockResolvedValue("user-2");

    await expect(
      harness.service.resolveUsernameAvailabilityHint("casey-doe"),
    ).resolves.toMatchObject({ available: false, reason: "taken" });
    expect(harness.authRepository.findUserIdByUsername).toHaveBeenCalled();
  });

  it("still exempts the caller's own username on the fallback path", async () => {
    const harness = createHarness();
    harness.authRepository.findUserIdByUsername.mockResolvedValue("user-1");

    await expect(
      harness.service.resolveUsernameAvailabilityHint("casey-doe", "user-1"),
    ).resolves.toMatchObject({ available: true });
  });
});

describe("UsernameService.assertUsernameIsAvailable", () => {
  it("passes for a free username", async () => {
    const harness = createHarness();

    await expect(
      harness.service.assertUsernameIsAvailable("casey-doe"),
    ).resolves.toBeUndefined();
  });

  it("throws a field-tagged conflict for a taken username", async () => {
    const harness = createHarness();
    harness.authRepository.findUserIdByUsername.mockResolvedValue("user-2");

    await expect(
      harness.service.assertUsernameIsAvailable("casey-doe"),
    ).rejects.toMatchObject({
      constructor: ConflictError,
      details: { field: "username" },
    });
  });
});

describe("UsernameService.forgotUsername", () => {
  it("sends a reminder to the email on file", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByEmail.mockResolvedValue(createUser());

    await expect(
      harness.service.forgotUsername({
        client: createClient(),
        email: "user@example.com",
      }),
    ).resolves.toEqual({ accepted: true });

    expect(harness.emailService.sendUsernameReminderEmail).toHaveBeenCalledWith(
      {
        to: "user@example.com",
        username: "test-user",
        firstName: "Test",
      },
    );
  });

  it("reminds a social-only account of its generated username", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByEmail.mockResolvedValue(
      createUser({
        passwordHash: undefined,
        profile: { ...createUser().profile, username: "auto-generated-name" },
      }),
    );

    await harness.service.forgotUsername({
      client: createClient(),
      email: "user@example.com",
    });

    expect(harness.emailService.sendUsernameReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ username: "auto-generated-name" }),
    );
  });

  it("accepts an unknown address without sending anything", async () => {
    // Answering identically either way is what stops the endpoint being used to
    // test which addresses are registered.
    const harness = createHarness();

    await expect(
      harness.service.forgotUsername({
        client: createClient(),
        email: "nobody@example.com",
      }),
    ).resolves.toEqual({ accepted: true });
    expect(
      harness.emailService.sendUsernameReminderEmail,
    ).not.toHaveBeenCalled();
  });

  it("still reports acceptance when the request is rate limited", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByEmail.mockResolvedValue(createUser());
    harness.store.set(
      "auth:otp-rate:username-reminder:email:user@example.com",
      { count: 5 },
    );

    await expect(
      harness.service.forgotUsername({
        client: createClient(),
        email: "user@example.com",
      }),
    ).resolves.toEqual({ accepted: true });
    expect(
      harness.emailService.sendUsernameReminderEmail,
    ).not.toHaveBeenCalled();
  });
});
