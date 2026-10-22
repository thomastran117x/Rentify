import ConflictError from "@/errors/http/conflict.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { AccountStatusService } from "@/features/auth/account-status/account-status.service";
import type { AccountStatusChangeInput } from "@/features/auth/account-status/account-status.model";
import type { AccountStatus, AuthUserRecord } from "@/features/auth/auth.model";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 377401);
const ADMIN_ID = testUuid(9000, 377402);
const NOW = new Date("2026-10-21T09:00:00.000Z");
const CONTEXT = { ipAddress: "203.0.113.7", requestId: "request-1" };

const adminInput: AccountStatusChangeInput = {
  reason: "Reported account takeover",
  source: "admin",
  actorUserId: ADMIN_ID,
  context: CONTEXT,
};

function createUser(status: AccountStatus): AuthUserRecord {
  return {
    id: USER_ID,
    email: "user@example.com",
    tokenVersion: 3,
    firstName: "Jane",
    role: "user",
    status,
    emailVerified: true,
    oauthIdentities: [],
    organizationMemberships: [],
    profile: {
      avatarVariants: null,
      id: testUuid(9000, 377403),
      userId: USER_ID,
      username: "jane-doe",
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

function createHarness(status: AccountStatus | null = "active") {
  const usersRepository = {
    findUserById: jest.fn(async () => (status ? createUser(status) : null)),
    updateAccountStatus: jest.fn(async () => true),
    findSecurityProfile: jest.fn(async () => ({
      statusReason: "Earlier reason",
      statusChangedAt: "2026-10-01T00:00:00.000Z",
      statusChangedBy: ADMIN_ID,
    })),
  };
  const tokenService = {
    revokeSessionsForUser: jest.fn(async () => ["session-1"]),
  };
  const authAuditService = {
    recordSafely: jest.fn(async () => undefined),
  };
  const emailService = {
    sendAccountLockedEmail: jest.fn(async () => undefined),
    sendAccountSuspendedEmail: jest.fn(async () => undefined),
    sendAccountReinstatedEmail: jest.fn(async () => undefined),
  };

  return {
    usersRepository,
    tokenService,
    authAuditService,
    emailService,
    service: new AccountStatusService(
      usersRepository as never,
      tokenService as never,
      authAuditService as never,
      emailService as never,
      () => NOW,
    ),
  };
}

describe("AccountStatusService.lock", () => {
  it("locks, ends every session, audits and emails the user", async () => {
    const harness = createHarness("active");

    const result = await harness.service.lock(USER_ID, adminInput);

    expect(result).toEqual({
      userId: USER_ID,
      status: "locked",
      statusReason: "Reported account takeover",
      statusChangedAt: NOW.toISOString(),
      statusChangedBy: ADMIN_ID,
      changed: true,
    });
    expect(harness.usersRepository.updateAccountStatus).toHaveBeenCalledWith(
      USER_ID,
      {
        expectedStatus: "active",
        status: "locked",
        reason: "Reported account takeover",
        changedAt: NOW,
        changedBy: ADMIN_ID,
        rotateTokenVersion: true,
      },
    );
    expect(harness.tokenService.revokeSessionsForUser).toHaveBeenCalledWith(
      USER_ID,
    );
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "account.locked",
      outcome: "success",
      userId: USER_ID,
      actorUserId: ADMIN_ID,
      context: CONTEXT,
      metadata: {
        source: "admin",
        previousStatus: "active",
        reason: "Reported account takeover",
      },
    });
    expect(harness.emailService.sendAccountLockedEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      firstName: "Jane",
    });
  });

  it("re-locking records the new reason and ends sessions, without a second email", async () => {
    const harness = createHarness("locked");

    await harness.service.lock(USER_ID, { ...adminInput, reason: "Newer" });

    expect(harness.usersRepository.updateAccountStatus).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ reason: "Newer", rotateTokenVersion: true }),
    );
    expect(harness.tokenService.revokeSessionsForUser).toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "account.locked",
        metadata: expect.objectContaining({ previousStatus: "locked" }),
      }),
    );
    expect(harness.emailService.sendAccountLockedEmail).not.toHaveBeenCalled();
  });

  it("refuses to downgrade a suspension to a security hold", async () => {
    const harness = createHarness("suspended");

    await expect(
      harness.service.lock(USER_ID, adminInput),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.usersRepository.updateAccountStatus).not.toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
  });

  it("is a 404 for an unknown account", async () => {
    const harness = createHarness(null);

    await expect(
      harness.service.lock(USER_ID, adminInput),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});

describe("AccountStatusService.suspend", () => {
  it.each(["active", "locked"] as const)(
    "suspends a %s account and emails the user",
    async (status) => {
      const harness = createHarness(status);

      const result = await harness.service.suspend(USER_ID, adminInput);

      expect(result.status).toBe("suspended");
      expect(harness.usersRepository.updateAccountStatus).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({
          status: "suspended",
          rotateTokenVersion: true,
        }),
      );
      expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "account.suspended",
          metadata: expect.objectContaining({ previousStatus: status }),
        }),
      );
      expect(
        harness.emailService.sendAccountSuspendedEmail,
      ).toHaveBeenCalledTimes(1);
    },
  );
});

describe("AccountStatusService.reinstate", () => {
  it("reinstates without touching the token version or sessions", async () => {
    const harness = createHarness("suspended");

    const result = await harness.service.reinstate(USER_ID, adminInput);

    expect(result).toMatchObject({ status: "active", changed: true });
    expect(harness.usersRepository.updateAccountStatus).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ status: "active", rotateTokenVersion: false }),
    );
    expect(harness.tokenService.revokeSessionsForUser).not.toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "account.reinstated" }),
    );
    expect(
      harness.emailService.sendAccountReinstatedEmail,
    ).toHaveBeenCalledTimes(1);
  });

  it("records a user-driven reinstatement with no actor", async () => {
    const harness = createHarness("locked");

    const result = await harness.service.reinstate(USER_ID, {
      reason: "Security hold cleared by a password reset.",
      source: "user",
    });

    expect(result.statusChangedBy).toBeNull();
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        metadata: expect.objectContaining({ source: "user" }),
      }),
    );
  });

  it("changes, records and sends nothing for an active account", async () => {
    const harness = createHarness("active");

    const result = await harness.service.reinstate(USER_ID, adminInput);

    expect(result).toEqual({
      userId: USER_ID,
      status: "active",
      statusReason: "Earlier reason",
      statusChangedAt: "2026-10-01T00:00:00.000Z",
      statusChangedBy: ADMIN_ID,
      changed: false,
    });
    expect(harness.usersRepository.updateAccountStatus).not.toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
    expect(
      harness.emailService.sendAccountReinstatedEmail,
    ).not.toHaveBeenCalled();
  });

  it("reports an active account with no history as never changed", async () => {
    const harness = createHarness("active");
    harness.usersRepository.findSecurityProfile.mockResolvedValueOnce(
      null as never,
    );

    await expect(
      harness.service.reinstate(USER_ID, adminInput),
    ).resolves.toMatchObject({
      statusReason: null,
      statusChangedAt: null,
      statusChangedBy: null,
    });
  });
});

describe("AccountStatusService best-effort side effects", () => {
  it("keeps a committed change when sessions cannot be revoked or the email cannot be queued", async () => {
    const harness = createHarness("active");
    harness.tokenService.revokeSessionsForUser.mockRejectedValueOnce(
      new Error("redis down"),
    );
    harness.emailService.sendAccountSuspendedEmail.mockRejectedValueOnce(
      new Error("rabbit down"),
    );

    await expect(
      harness.service.suspend(USER_ID, adminInput),
    ).resolves.toMatchObject({ status: "suspended" });
    expect(harness.authAuditService.recordSafely).toHaveBeenCalled();
  });
});

describe("AccountStatusService concurrent changes", () => {
  it("refuses an admin change when the status moved after it was read", async () => {
    const harness = createHarness("active");
    harness.usersRepository.updateAccountStatus.mockResolvedValueOnce(false);

    await expect(
      harness.service.suspend(USER_ID, adminInput),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.tokenService.revokeSessionsForUser).not.toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
    expect(
      harness.emailService.sendAccountSuspendedEmail,
    ).not.toHaveBeenCalled();
  });
});

describe("AccountStatusService.liftSecurityHold", () => {
  const recovery = {
    reason: "Security hold cleared by a password reset.",
    context: CONTEXT,
  };

  it("lifts only a hold, recording the user as the source", async () => {
    const harness = createHarness("locked");

    await expect(
      harness.service.liftSecurityHold(USER_ID, recovery),
    ).resolves.toBe("active");
    expect(harness.usersRepository.updateAccountStatus).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        expectedStatus: "locked",
        status: "active",
        changedBy: null,
      }),
    );
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "account.reinstated",
        actorUserId: null,
        metadata: expect.objectContaining({
          source: "user",
          previousStatus: "locked",
        }),
      }),
    );
  });

  it.each(["active", "suspended"] as const)(
    "leaves a %s account as it is",
    async (status) => {
      const harness = createHarness(status);

      await expect(
        harness.service.liftSecurityHold(USER_ID, recovery),
      ).resolves.toBe(status);
      expect(
        harness.usersRepository.updateAccountStatus,
      ).not.toHaveBeenCalled();
      expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
    },
  );

  it("reports a suspension that landed between the read and the write", async () => {
    const harness = createHarness("locked");
    harness.usersRepository.updateAccountStatus.mockResolvedValueOnce(false);
    harness.usersRepository.findUserById
      .mockResolvedValueOnce(createUser("locked"))
      .mockResolvedValueOnce(createUser("suspended"));

    await expect(
      harness.service.liftSecurityHold(USER_ID, recovery),
    ).resolves.toBe("suspended");
    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
    expect(
      harness.emailService.sendAccountReinstatedEmail,
    ).not.toHaveBeenCalled();
  });
});
