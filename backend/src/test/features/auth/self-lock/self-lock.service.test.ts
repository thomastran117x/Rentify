import ConflictError from "@/errors/http/conflict.error";
import GoneError from "@/errors/http/gone-error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { AccountStatus, AuthUserRecord } from "@/features/auth/auth.model";
import { SelfLockService } from "@/features/auth/self-lock/self-lock.service";
import { asUuid } from "@/configuration/validation/uuid";
import { testUuid } from "../../../support/uuid";

const USER_ID = asUuid(testUuid(9000, 378201));
const EVENT_ID = asUuid(testUuid(9000, 378202));
const CONTEXT = { ipAddress: "203.0.113.7", requestId: "request-1" };
const BCRYPT_HASH = `$2b$10$${"a".repeat(53)}`;

function createUser(
  status: AccountStatus,
  overrides: Partial<AuthUserRecord> = {},
): AuthUserRecord {
  return {
    id: USER_ID,
    email: "user@example.com",
    passwordHash: BCRYPT_HASH,
    tokenVersion: 1,
    firstName: "Jane",
    role: "user",
    status,
    emailVerified: true,
    oauthIdentities: [],
    organizationMemberships: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AuthUserRecord;
}

function createHarness(user: AuthUserRecord | null = createUser("active")) {
  const selfLockTokenStore = {
    claim: jest.fn(async () => ({
      userId: USER_ID,
      sourceEventId: EVENT_ID,
    })),
    complete: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
  };
  const usersRepository = {
    findUserById: jest.fn(async () => user),
  };
  const accountStatusService = {
    lock: jest.fn(async () => ({ status: "locked" })),
  };

  return {
    selfLockTokenStore,
    usersRepository,
    accountStatusService,
    service: new SelfLockService(
      selfLockTokenStore as never,
      usersRepository as never,
      accountStatusService as never,
    ),
  };
}

describe("SelfLockService.lockWithToken", () => {
  it("locks the token's account as the user, naming the email's event", async () => {
    const harness = createHarness();

    await expect(
      harness.service.lockWithToken("token-1", CONTEXT),
    ).resolves.toEqual({ locked: true });

    expect(harness.selfLockTokenStore.claim).toHaveBeenCalledWith("token-1");
    expect(harness.accountStatusService.lock).toHaveBeenCalledWith(USER_ID, {
      reason: "Reported by user",
      source: "user",
      actorUserId: null,
      context: CONTEXT,
      metadata: { channel: "email_link", sourceEventId: EVENT_ID },
    });
    expect(harness.selfLockTokenStore.complete).toHaveBeenCalledWith("token-1");
    expect(harness.selfLockTokenStore.release).not.toHaveBeenCalled();
  });

  it("answers a spent, expired or unknown token with one generic 410", async () => {
    const harness = createHarness();
    harness.selfLockTokenStore.claim.mockResolvedValueOnce(null as never);

    const attempt = harness.service.lockWithToken("token-1");

    await expect(attempt).rejects.toBeInstanceOf(GoneError);
    await expect(attempt).rejects.toThrow(
      "This link has expired or was already used.",
    );
    expect(harness.usersRepository.findUserById).not.toHaveBeenCalled();
    expect(harness.accountStatusService.lock).not.toHaveBeenCalled();
    expect(harness.selfLockTokenStore.complete).not.toHaveBeenCalled();
  });

  it.each(["locked", "suspended"] as const)(
    "leaves a %s account unchanged, answers as if it locked and spends the link",
    async (status) => {
      const harness = createHarness(createUser(status));

      await expect(harness.service.lockWithToken("token-1")).resolves.toEqual({
        locked: true,
      });
      expect(harness.accountStatusService.lock).not.toHaveBeenCalled();
      expect(harness.selfLockTokenStore.complete).toHaveBeenCalledWith(
        "token-1",
      );
    },
  );

  it("answers the same for an account deleted since the email", async () => {
    const harness = createHarness(null);

    await expect(harness.service.lockWithToken("token-1")).resolves.toEqual({
      locked: true,
    });
    expect(harness.accountStatusService.lock).not.toHaveBeenCalled();
  });

  it("swallows a status change that lands between the read and the write", async () => {
    const harness = createHarness();
    harness.accountStatusService.lock.mockRejectedValueOnce(
      new ConflictError("changed"),
    );

    await expect(harness.service.lockWithToken("token-1")).resolves.toEqual({
      locked: true,
    });
    expect(harness.selfLockTokenStore.complete).toHaveBeenCalledWith("token-1");
  });

  it("puts the link back when the lock fails unexpectedly, so a retry can use it", async () => {
    const harness = createHarness();
    harness.accountStatusService.lock.mockRejectedValueOnce(
      new ResourceNotFoundError("User not found."),
    );

    await expect(
      harness.service.lockWithToken("token-1"),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(harness.selfLockTokenStore.release).toHaveBeenCalledWith("token-1");
    expect(harness.selfLockTokenStore.complete).not.toHaveBeenCalled();
  });

  it("puts the link back when the account cannot be read", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(harness.service.lockWithToken("token-1")).rejects.toThrow(
      "database unavailable",
    );
    expect(harness.selfLockTokenStore.release).toHaveBeenCalledWith("token-1");
  });

  it("reports the original failure even when the link cannot be put back", async () => {
    const harness = createHarness();
    harness.accountStatusService.lock.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    harness.selfLockTokenStore.release.mockRejectedValueOnce(
      new Error("redis unavailable"),
    );

    await expect(harness.service.lockWithToken("token-1")).rejects.toThrow(
      "database unavailable",
    );
  });
});

describe("SelfLockService.lockFromSession", () => {
  it("locks the caller's account through the session channel", async () => {
    const harness = createHarness();

    await expect(
      harness.service.lockFromSession(USER_ID, CONTEXT),
    ).resolves.toEqual({ locked: true });

    expect(harness.accountStatusService.lock).toHaveBeenCalledWith(USER_ID, {
      reason: "Reported by user",
      source: "user",
      actorUserId: null,
      context: CONTEXT,
      metadata: { channel: "session" },
    });
  });

  it.each([
    [
      "has no local password",
      createUser("active", { passwordHash: undefined }),
    ],
    ["has an unverified email", createUser("active", { emailVerified: false })],
  ])(
    "refuses an account that %s, because it could not recover",
    async (_label, user) => {
      const harness = createHarness(user);

      const attempt = harness.service.lockFromSession(USER_ID);

      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toMatchObject({
        details: { reason: "password_reset_unavailable" },
      });
      expect(harness.accountStatusService.lock).not.toHaveBeenCalled();
    },
  );

  it("refuses an account that no longer exists", async () => {
    const harness = createHarness(null);

    await expect(
      harness.service.lockFromSession(USER_ID),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
