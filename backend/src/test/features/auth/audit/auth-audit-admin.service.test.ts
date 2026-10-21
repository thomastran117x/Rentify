import { AuthAuditAdminService } from "@/features/auth/audit/auth-audit-admin.service";
import {
  decodeActivityCursor,
  encodeActivityCursor,
} from "@/features/auth/audit/auth-audit-activity";
import {
  adminAuthAuditQuerySchema,
  type AuthAuditAdminRow,
} from "@/features/auth/audit/auth-audit-admin.model";
import type { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { DeviceRepository } from "@/features/auth/device/device.repository";
import type { LoginLockoutService } from "@/features/auth/lockout/login-lockout.service";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { RequestValidationError } from "@/configuration/validation/request";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 376201);
const ADMIN_ID = testUuid(9000, 376202);
const NOW = new Date("2026-10-18T12:00:00.000Z");
const READER = {
  userId: ADMIN_ID,
  context: { ipAddress: "198.51.100.4", requestId: "request-1" },
};

function createRow(index: number, overrides: Partial<AuthAuditAdminRow> = {}) {
  return {
    id: testUuid(9100, index),
    userId: USER_ID,
    actorUserId: null,
    eventType: "login.failed",
    outcome: "failure",
    reasonCode: "bad_credentials",
    method: "password",
    ipAddress: "203.0.113.7",
    userAgent: null,
    deviceId: null,
    sessionId: null,
    requestId: null,
    metadata: null,
    createdAt: new Date(Date.UTC(2026, 9, 18, 11, 0, 60 - index)),
    ...overrides,
  } satisfies AuthAuditAdminRow;
}

function createService(rows: AuthAuditAdminRow[] | null = []) {
  const calls: string[] = [];
  const repository = {
    listForAdmin: jest.fn(async () => {
      calls.push("list");
      return rows;
    }),
    countForUser: jest.fn(async () => 0),
  };
  const authAuditService = {
    record: jest.fn(async () => {
      calls.push("record");
    }),
    hashIdentifier: jest.fn((value: string) => `hash:${value}`),
  };
  const usersRepository = {
    findUserIdByEmail: jest.fn(async (): Promise<string | null> => null),
    findUserIdByUsername: jest.fn(async (): Promise<string | null> => null),
    listIdentitySummariesByIds: jest.fn(async () => [
      { id: USER_ID, email: "user@example.com", username: "user-one" },
    ]),
    findSecurityProfile: jest.fn(
      async (): Promise<unknown> => ({
        id: USER_ID,
        email: "user@example.com",
        username: "user-one",
        role: "user",
        lastLoginAt: "2026-10-17T09:00:00.000Z",
      }),
    ),
  };
  const deviceRepository = {
    listKnownDevices: jest.fn(async () => [
      {
        id: testUuid(9200, 1),
        userId: USER_ID,
        deviceId: "laptop",
        type: "desktop",
        platform: "Windows",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        lastIpAddress: "203.0.113.7",
        firstSeenAt: "2026-09-01T00:00:00.000Z",
        lastSeenAt: "2026-10-17T09:00:00.000Z",
        verifiedAt: "2026-09-01T00:00:00.000Z",
      },
    ]),
  };
  const loginLockoutService = {
    getAttemptRecord: jest.fn(async (): Promise<unknown> => null),
  };

  return {
    calls,
    repository,
    authAuditService,
    usersRepository,
    deviceRepository,
    loginLockoutService,
    service: new AuthAuditAdminService(
      repository as unknown as AuthAuditRepository,
      authAuditService as unknown as AuthAuditService,
      usersRepository as unknown as UsersRepository,
      deviceRepository as unknown as DeviceRepository,
      loginLockoutService as unknown as LoginLockoutService,
      () => NOW,
    ),
  };
}

function query(input: Record<string, unknown> = {}) {
  return adminAuthAuditQuerySchema.parse(input);
}

describe("AuthAuditAdminService.listEvents", () => {
  it("records the read before querying, then returns a page and its cursor", async () => {
    const rows = [createRow(1), createRow(2), createRow(3)];
    const { service, calls, repository, authAuditService } =
      createService(rows);

    const result = await service.listEvents(query({ limit: "2" }), READER);

    expect(calls).toEqual(["record", "list"]);
    expect(authAuditService.record).toHaveBeenCalledWith({
      eventType: "admin.audit_viewed",
      outcome: "success",
      userId: null,
      actorUserId: ADMIN_ID,
      context: READER.context,
      metadata: {
        view: "events",
        filter_from: "2026-10-11T12:00:00.000Z",
        filter_to: "2026-10-18T12:00:00.000Z",
        limit: 2,
      },
    });
    expect(repository.listForAdmin).toHaveBeenCalledWith({
      afterId: undefined,
      createdFrom: new Date("2026-10-11T12:00:00.000Z"),
      createdBefore: NOW,
      limit: 3,
    });
    expect(result.items.map((item) => item.id)).toEqual([
      rows[0].id,
      rows[1].id,
    ]);
    expect(result.items[0].subject).toEqual({
      id: USER_ID,
      email: "user@example.com",
      username: "user-one",
    });
    expect(decodeActivityCursor(result.nextCursor!)).toBe(rows[1].id);
    expect(result.range).toEqual({
      from: "2026-10-11T12:00:00.000Z",
      to: "2026-10-18T12:00:00.000Z",
    });
  });

  it("returns a null cursor on the last page and passes a decoded cursor on", async () => {
    const { service, repository } = createService([createRow(1)]);
    const cursor = encodeActivityCursor(testUuid(9100, 50));

    const result = await service.listEvents(query({ cursor }), READER);

    expect(result.nextCursor).toBeNull();
    expect(repository.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ afterId: testUuid(9100, 50) }),
    );
  });

  it("resolves an email to its account", async () => {
    const { service, usersRepository, repository } = createService();
    usersRepository.findUserIdByEmail.mockResolvedValueOnce(USER_ID);

    await service.listEvents(query({ user: "User@Example.com" }), READER);

    expect(usersRepository.findUserIdByEmail).toHaveBeenCalledWith(
      "User@Example.com",
    );
    expect(usersRepository.findUserIdByUsername).not.toHaveBeenCalled();
    expect(repository.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  it("resolves a username to its account", async () => {
    const { service, usersRepository, repository } = createService();
    usersRepository.findUserIdByUsername.mockResolvedValueOnce(USER_ID);

    await service.listEvents(query({ user: "user-one" }), READER);

    expect(usersRepository.findUserIdByUsername).toHaveBeenCalledWith(
      "user-one",
    );
    expect(repository.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  it("falls back to the identifier hash for a name that matches no account", async () => {
    const { service, authAuditService, repository } = createService([
      createRow(1, { userId: null }),
    ]);

    const result = await service.listEvents(query({ user: "ghost" }), READER);

    expect(authAuditService.hashIdentifier).toHaveBeenCalledWith("ghost");
    const filter = (repository.listForAdmin.mock.calls[0] as unknown[])[0];
    expect(filter).toMatchObject({ identifierHash: "hash:ghost" });
    expect(filter).not.toHaveProperty("userId");
    expect(result.items[0].subject).toBeNull();
  });

  it("uses a userId filter without any lookup", async () => {
    const { service, usersRepository, repository } = createService();

    await service.listEvents(query({ userId: USER_ID }), READER);

    expect(usersRepository.findUserIdByEmail).not.toHaveBeenCalled();
    expect(usersRepository.findUserIdByUsername).not.toHaveBeenCalled();
    expect(repository.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  it("returns no data when the audit write fails", async () => {
    const { service, authAuditService, repository } = createService();
    authAuditService.record.mockRejectedValueOnce(new Error("db down"));

    await expect(service.listEvents(query(), READER)).rejects.toThrow(
      "db down",
    );
    expect(repository.listForAdmin).not.toHaveBeenCalled();
  });

  it("rejects an invalid range or cursor before recording anything", async () => {
    const { service, authAuditService } = createService();

    await expect(
      service.listEvents(query({ from: "2026-01-01T00:00:00Z" }), READER),
    ).rejects.toBeInstanceOf(RequestValidationError);
    await expect(
      service.listEvents(query({ cursor: "not-a-cursor" }), READER),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(authAuditService.record).not.toHaveBeenCalled();
  });

  it("rejects a cursor the repository does not recognise under these filters", async () => {
    const { service } = createService(null);

    await expect(
      service.listEvents(
        query({ cursor: encodeActivityCursor(testUuid(9100, 50)) }),
        READER,
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
  });
});

describe("AuthAuditAdminService.getUserSecuritySummary", () => {
  it("aggregates the account, counts, lockout, devices and recent events", async () => {
    const {
      service,
      repository,
      authAuditService,
      loginLockoutService,
      calls,
    } = createService([createRow(1)]);
    repository.countForUser.mockResolvedValueOnce(3).mockResolvedValueOnce(7);
    loginLockoutService.getAttemptRecord.mockResolvedValueOnce({
      failedAttempts: 5,
      lockedAt: "2026-10-18T11:50:00.000Z",
    });

    const summary = await service.getUserSecuritySummary(USER_ID, READER);

    expect(calls[0]).toBe("record");
    expect(authAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "admin.audit_viewed",
        userId: null,
        actorUserId: ADMIN_ID,
        metadata: { view: "user_summary", target_user_id: USER_ID },
      }),
    );
    expect(repository.countForUser).toHaveBeenNthCalledWith(1, {
      userId: USER_ID,
      eventTypes: ["login.failed", "oauth.login.failed"],
      createdFrom: new Date("2026-10-17T12:00:00.000Z"),
    });
    expect(repository.countForUser).toHaveBeenNthCalledWith(2, {
      userId: USER_ID,
      eventTypes: ["login.failed", "oauth.login.failed"],
      createdFrom: new Date("2026-10-11T12:00:00.000Z"),
    });
    expect(loginLockoutService.getAttemptRecord).toHaveBeenCalledWith(
      "user-one",
    );
    expect(repository.listForAdmin).toHaveBeenCalledWith({
      userId: USER_ID,
      createdFrom: new Date("2026-07-20T12:00:00.000Z"),
      createdBefore: NOW,
      limit: 20,
    });
    expect(summary).toEqual({
      user: {
        id: USER_ID,
        email: "user@example.com",
        username: "user-one",
        role: "user",
      },
      accountStatus: "active",
      lastLoginAt: "2026-10-17T09:00:00.000Z",
      failedSignIns: { last24Hours: 3, last7Days: 7 },
      lockout: {
        locked: true,
        failedAttempts: 5,
        lockedAt: "2026-10-18T11:50:00.000Z",
        lockedUntil: "2026-10-18T12:20:00.000Z",
      },
      devices: [
        {
          id: testUuid(9200, 1),
          deviceId: "laptop",
          type: "desktop",
          platform: "Windows",
          browser: "Chrome",
          os: "Windows",
          lastIpAddress: "203.0.113.7",
          firstSeenAt: "2026-09-01T00:00:00.000Z",
          lastSeenAt: "2026-10-17T09:00:00.000Z",
        },
      ],
      recentEvents: [expect.objectContaining({ id: testUuid(9100, 1) })],
    });
  });

  it("reports failed attempts that have not locked the account yet", async () => {
    const { service, loginLockoutService } = createService();
    loginLockoutService.getAttemptRecord.mockResolvedValueOnce({
      failedAttempts: 2,
    });

    const summary = await service.getUserSecuritySummary(USER_ID, READER);

    expect(summary.lockout).toEqual({
      locked: false,
      failedAttempts: 2,
      lockedAt: null,
      lockedUntil: null,
    });
  });

  it("reports no lockout when there is no record, or no username to key one", async () => {
    const { service, usersRepository, loginLockoutService, deviceRepository } =
      createService(null);
    usersRepository.findSecurityProfile.mockResolvedValueOnce({
      id: USER_ID,
      email: "user@example.com",
      username: null,
      role: "user",
      lastLoginAt: null,
    });
    deviceRepository.listKnownDevices.mockResolvedValueOnce([
      {
        id: testUuid(9200, 2),
        userId: USER_ID,
        deviceId: "phone",
        type: "mobile",
        platform: undefined,
        userAgent: undefined,
        lastIpAddress: undefined,
        firstSeenAt: "2026-09-01T00:00:00.000Z",
        lastSeenAt: "2026-09-01T00:00:00.000Z",
        verifiedAt: "2026-09-01T00:00:00.000Z",
      } as never,
    ]);

    const summary = await service.getUserSecuritySummary(USER_ID, READER);

    expect(loginLockoutService.getAttemptRecord).not.toHaveBeenCalled();
    expect(summary.lockout).toEqual({
      locked: false,
      failedAttempts: 0,
      lockedAt: null,
      lockedUntil: null,
    });
    expect(summary.devices[0]).toMatchObject({
      platform: null,
      browser: null,
      lastIpAddress: null,
    });
    expect(summary.recentEvents).toEqual([]);
  });

  it("is a 404 for an unknown account, and records nothing", async () => {
    const { service, usersRepository, authAuditService } = createService();
    usersRepository.findSecurityProfile.mockResolvedValueOnce(null);

    await expect(
      service.getUserSecuritySummary(USER_ID, READER),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(authAuditService.record).not.toHaveBeenCalled();
  });

  it("returns no data when the audit write fails", async () => {
    const { service, authAuditService, repository } = createService();
    authAuditService.record.mockRejectedValueOnce(new Error("db down"));

    await expect(
      service.getUserSecuritySummary(USER_ID, READER),
    ).rejects.toThrow("db down");
    expect(repository.countForUser).not.toHaveBeenCalled();
  });
});

describe("AuthAuditAdminService defaults", () => {
  it("uses the real clock when none is injected", async () => {
    const {
      repository,
      authAuditService,
      usersRepository,
      deviceRepository,
      loginLockoutService,
    } = createService();
    const service = new AuthAuditAdminService(
      repository as unknown as AuthAuditRepository,
      authAuditService as unknown as AuthAuditService,
      usersRepository as unknown as UsersRepository,
      deviceRepository as unknown as DeviceRepository,
      loginLockoutService as unknown as LoginLockoutService,
    );
    const before = Date.now();

    const result = await service.listEvents(query(), READER);

    expect(Date.parse(result.range.to)).toBeGreaterThanOrEqual(before);
  });
});
