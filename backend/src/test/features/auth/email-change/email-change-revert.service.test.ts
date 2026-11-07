import { asUuid } from "@/configuration/validation/uuid";
import ConflictError from "@/errors/http/conflict.error";
import GoneError from "@/errors/http/gone-error";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import {
  EmailChangeRevertService,
  hashEmailChangeRevertToken,
} from "@/features/auth/email-change/email-change-revert.service";
import {
  EMAIL_CHANGE_REVERT_REASON,
  EMAIL_CHANGE_REVERT_TTL_SECONDS,
} from "@/features/auth/email-change/email-change.model";

const USER_ID = asUuid("00000000-0000-4000-8000-000000460011");
const EVENT_ID = asUuid("00000000-0000-4000-8000-000000460012");
const OLD_EMAIL = "old@rentify.local";
const NEW_EMAIL = "new@rentify.local";
const BCRYPT_HASH = `$2b$10$${"a".repeat(53)}`;
const NOW = new Date("2026-11-04T10:15:00.000Z");
const CONTEXT = { requestId: "request-1" };

const RECORD = {
  id: "revert-1",
  userId: USER_ID,
  oldEmail: OLD_EMAIL,
  newEmail: NEW_EMAIL,
  sourceEventId: EVENT_ID,
};

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: USER_ID,
    email: NEW_EMAIL,
    status: "active",
    emailVerified: true,
    passwordHash: BCRYPT_HASH,
    ...overrides,
  } as AuthUserRecord;
}

function createHarness() {
  const repository = {
    replaceOpenForUser: jest.fn(async () => undefined),
    claim: jest.fn(async () => RECORD as typeof RECORD | null),
    release: jest.fn(async () => undefined),
    deleteExpired: jest.fn(async () => 2),
  };
  const lock = { release: jest.fn(async () => undefined) };
  const emailChangeStore = {
    acquireConfirmLock: jest.fn(async () => lock as typeof lock | null),
    clear: jest.fn(async () => undefined),
  };
  const usersRepository = {
    findUserById: jest.fn(async () => createUser() as AuthUserRecord | null),
    restoreEmail: jest.fn(async () => true),
  };
  const accountStatusService = { lock: jest.fn(async () => ({})) };
  const tokenService = {
    revokeSessionsForUser: jest.fn(async () => ["session-1"]),
  };
  const authAuditService = { recordSafely: jest.fn(async () => undefined) };
  const service = new EmailChangeRevertService(
    repository as never,
    emailChangeStore as never,
    usersRepository as never,
    accountStatusService as never,
    tokenService as never,
    authAuditService as never,
    () => NOW,
  );

  return {
    service,
    repository,
    lock,
    emailChangeStore,
    usersRepository,
    accountStatusService,
    tokenService,
    authAuditService,
  };
}

describe("EmailChangeRevertService.issue", () => {
  const input = {
    userId: USER_ID,
    oldEmail: OLD_EMAIL,
    newEmail: NEW_EMAIL,
    sourceEventId: EVENT_ID,
  };

  it("stores only the hash of a random token, for seven days", async () => {
    const harness = createHarness();

    const token = await harness.service.issue(input);

    expect(token).toEqual(expect.any(String));
    expect(harness.repository.replaceOpenForUser).toHaveBeenCalledWith(
      {
        ...input,
        tokenHash: hashEmailChangeRevertToken(token!),
        expiresAt: new Date(
          NOW.getTime() + EMAIL_CHANGE_REVERT_TTL_SECONDS * 1000,
        ),
      },
      NOW,
    );
    expect(
      JSON.stringify(harness.repository.replaceOpenForUser.mock.calls),
    ).not.toContain(token);
  });

  it("gives each link its own token", async () => {
    const harness = createHarness();

    expect(await harness.service.issue(input)).not.toBe(
      await harness.service.issue(input),
    );
  });

  it("gives no link, rather than throwing, when it cannot be stored", async () => {
    const harness = createHarness();
    harness.repository.replaceOpenForUser.mockRejectedValue(
      new Error("Database down"),
    );

    await expect(harness.service.issue(input)).resolves.toBeUndefined();
  });
});

describe("EmailChangeRevertService.revert", () => {
  it("restores the address and holds an account that can reset its password", async () => {
    const harness = createHarness();

    await expect(harness.service.revert("token", CONTEXT)).resolves.toEqual({
      reverted: true,
      nextStep: "reset_password",
    });

    expect(harness.repository.claim).toHaveBeenCalledWith(
      hashEmailChangeRevertToken("token"),
      NOW,
    );
    expect(harness.accountStatusService.lock).toHaveBeenCalledWith(USER_ID, {
      reason: EMAIL_CHANGE_REVERT_REASON,
      source: "user",
      actorUserId: null,
      context: CONTEXT,
      metadata: { channel: "email_revert", sourceEventId: EVENT_ID },
      restoreEmail: { from: NEW_EMAIL, to: OLD_EMAIL },
    });
    expect(harness.usersRepository.restoreEmail).not.toHaveBeenCalled();
    expect(harness.emailChangeStore.clear).toHaveBeenCalledWith(USER_ID);
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "email.change_reverted",
      outcome: "success",
      userId: USER_ID,
      context: CONTEXT,
      metadata: {
        oldEmailMasked: "o***@rentify.local",
        newEmailMasked: "n***@rentify.local",
        sourceEventId: EVENT_ID,
      },
    });
    expect(harness.lock.release).toHaveBeenCalled();
    expect(harness.repository.release).not.toHaveBeenCalled();
  });

  it.each([
    ["has no password to reset", createUser({ passwordHash: undefined })],
    ["is suspended", createUser({ status: "suspended" })],
  ])(
    "ends sessions without a hold for an account that %s",
    async (_label, user) => {
      const harness = createHarness();
      harness.usersRepository.findUserById.mockResolvedValue(user);

      await expect(harness.service.revert("token", CONTEXT)).resolves.toEqual({
        reverted: true,
        nextStep: "sign_in",
      });

      expect(harness.accountStatusService.lock).not.toHaveBeenCalled();
      expect(harness.usersRepository.restoreEmail).toHaveBeenCalledWith(
        USER_ID,
        { from: NEW_EMAIL, to: OLD_EMAIL },
      );
      expect(harness.tokenService.revokeSessionsForUser).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(harness.authAuditService.recordSafely).toHaveBeenCalledTimes(1);
    },
  );

  it("still restores the address of an account the user already self-locked", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockResolvedValue(
      createUser({ status: "locked" }),
    );

    await expect(harness.service.revert("token")).resolves.toMatchObject({
      nextStep: "reset_password",
    });

    expect(harness.accountStatusService.lock).toHaveBeenCalledTimes(1);
  });

  it("answers an unusable link with a 410 and touches nothing", async () => {
    const harness = createHarness();
    harness.repository.claim.mockResolvedValue(null);

    await expect(harness.service.revert("token")).rejects.toBeInstanceOf(
      GoneError,
    );

    expect(harness.emailChangeStore.acquireConfirmLock).not.toHaveBeenCalled();
    expect(harness.accountStatusService.lock).not.toHaveBeenCalled();
  });

  it("stops working once the account's email has changed again, and stays spent", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockResolvedValue(
      createUser({ email: "later@rentify.local" }),
    );

    await expect(harness.service.revert("token")).rejects.toBeInstanceOf(
      GoneError,
    );

    expect(harness.accountStatusService.lock).not.toHaveBeenCalled();
    expect(harness.usersRepository.restoreEmail).not.toHaveBeenCalled();
    expect(harness.repository.release).not.toHaveBeenCalled();
    expect(harness.lock.release).toHaveBeenCalled();
  });

  it("answers a 410 for an account that no longer exists", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockResolvedValue(null);

    await expect(harness.service.revert("token")).rejects.toBeInstanceOf(
      GoneError,
    );
  });

  it("answers a 410 when the address moves between the read and the write", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockResolvedValue(
      createUser({ passwordHash: undefined }),
    );
    harness.usersRepository.restoreEmail.mockResolvedValue(false);

    await expect(harness.service.revert("token")).rejects.toBeInstanceOf(
      GoneError,
    );

    expect(harness.tokenService.revokeSessionsForUser).not.toHaveBeenCalled();
    expect(harness.repository.release).not.toHaveBeenCalled();
  });

  it("puts the link back after an unexpected failure, so it can be retried", async () => {
    const harness = createHarness();
    harness.accountStatusService.lock.mockRejectedValue(
      new Error("Database down"),
    );

    await expect(harness.service.revert("token")).rejects.toThrow(
      "Database down",
    );

    expect(harness.repository.release).toHaveBeenCalledWith("revert-1");
    expect(harness.lock.release).toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
  });

  it("puts the link back when the old address was taken regardless", async () => {
    const harness = createHarness();
    harness.accountStatusService.lock.mockRejectedValue(
      new ConflictError("That email address is not available."),
    );

    await expect(harness.service.revert("token")).rejects.toBeInstanceOf(
      ConflictError,
    );

    expect(harness.repository.release).toHaveBeenCalledWith("revert-1");
  });

  it("reports the original failure when the link cannot be put back", async () => {
    const harness = createHarness();
    harness.accountStatusService.lock.mockRejectedValue(
      new Error("Database down"),
    );
    harness.repository.release.mockRejectedValue(new Error("Still down"));

    await expect(harness.service.revert("token")).rejects.toThrow(
      "Database down",
    );
  });

  it("asks for a retry while a confirmation holds the lock", async () => {
    const harness = createHarness();
    harness.emailChangeStore.acquireConfirmLock.mockResolvedValue(null);

    await expect(harness.service.revert("token")).rejects.toBeInstanceOf(
      ConflictError,
    );

    expect(harness.accountStatusService.lock).not.toHaveBeenCalled();
    expect(harness.repository.release).toHaveBeenCalledWith("revert-1");
  });

  it("does not undo a restored address over a session cleanup failure", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockResolvedValue(
      createUser({ passwordHash: undefined }),
    );
    harness.tokenService.revokeSessionsForUser.mockRejectedValue(
      new Error("Redis down"),
    );

    await expect(harness.service.revert("token")).resolves.toMatchObject({
      reverted: true,
    });
  });

  it("does not fail a restored address over a pending change it cannot clear", async () => {
    const harness = createHarness();
    harness.emailChangeStore.clear.mockRejectedValue(new Error("Redis down"));

    await expect(harness.service.revert("token")).resolves.toMatchObject({
      reverted: true,
    });

    expect(harness.authAuditService.recordSafely).toHaveBeenCalledTimes(1);
  });
});

describe("EmailChangeRevertService.pruneExpired", () => {
  it("deletes what has expired by now", async () => {
    const harness = createHarness();

    await expect(harness.service.pruneExpired()).resolves.toBe(2);

    expect(harness.repository.deleteExpired).toHaveBeenCalledWith(NOW);
  });
});
