import { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import { testUuid } from "../../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

describe("AuthAuditRepository", () => {
  it("inserts an event with every field mapped to its column", async () => {
    const create = jest.fn(async () => undefined);
    const repository = new AuthAuditRepository({
      authAuditEvent: { create },
    } as any);

    await repository.create({
      eventType: "login.locked",
      outcome: "blocked",
      userId: USER_1_ID,
      reasonCode: "locked",
      method: "password",
      identifierHash: "a".repeat(64),
      sessionId: "session-1",
      context: {
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0",
        deviceId: "device-1",
        requestId: "request-1",
      },
      metadata: { triggered: true },
      flagged: true,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        userId: USER_1_ID,
        actorUserId: null,
        eventType: "login.locked",
        outcome: "blocked",
        reasonCode: "locked",
        method: "password",
        identifierHash: "a".repeat(64),
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0",
        deviceId: "device-1",
        sessionId: "session-1",
        requestId: "request-1",
        metadata: { triggered: true },
        flagged: true,
      },
    });
  });

  it("keeps an id the caller chose up front", async () => {
    const create = jest.fn(async (_args: { data: Record<string, unknown> }) => {
      return undefined;
    });
    const repository = new AuthAuditRepository({
      authAuditEvent: { create },
    } as any);
    const id = testUuid(9000, 378401);

    await repository.create({
      id,
      eventType: "device.new_detected",
      outcome: "success",
    });

    expect(create.mock.calls[0]![0].data).toMatchObject({ id });
  });

  it("stores nulls for absent fields and cuts client values to column width", async () => {
    const create = jest.fn(async (_args: { data: Record<string, unknown> }) => {
      return undefined;
    });
    const repository = new AuthAuditRepository({
      authAuditEvent: { create },
    } as any);

    await repository.create({
      eventType: "login.failed",
      outcome: "failure",
      context: {
        userAgent: "u".repeat(600),
        deviceId: "d".repeat(100),
        ipAddress: "i".repeat(60),
        requestId: "r".repeat(80),
      },
    });

    const data = create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      userId: null,
      actorUserId: null,
      reasonCode: null,
      method: null,
      identifierHash: null,
      sessionId: null,
      metadata: undefined,
      flagged: false,
    });
    expect(data.userAgent).toHaveLength(512);
    expect(data.deviceId).toHaveLength(64);
    expect(data.ipAddress).toHaveLength(45);
    expect(data.requestId).toHaveLength(64);
  });

  it("writes an event without any request context", async () => {
    const create = jest.fn(async (_args: { data: Record<string, unknown> }) => {
      return undefined;
    });
    const repository = new AuthAuditRepository({
      authAuditEvent: { create },
    } as any);

    await repository.create({ eventType: "logout", outcome: "success" });

    expect(create.mock.calls[0]![0].data).toMatchObject({
      ipAddress: null,
      userAgent: null,
      deviceId: null,
      requestId: null,
    });
  });

  it("does not retry a failed insert", async () => {
    const create = jest.fn(async () => {
      throw Object.assign(new Error("connection lost"), { code: "P1001" });
    });
    const repository = new AuthAuditRepository({
      authAuditEvent: { create },
    } as any);

    await expect(
      repository.create({ eventType: "logout", outcome: "success" }),
    ).rejects.toThrow("connection lost");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("lists the oldest ids created before the cutoff", async () => {
    const cutoff = new Date("2026-04-20T12:00:00.000Z");
    const findMany = jest.fn(async () => [{ id: "a" }, { id: "b" }]);
    const repository = new AuthAuditRepository({
      authAuditEvent: { findMany },
    } as any);

    await expect(repository.listIdsCreatedBefore(cutoff, 2)).resolves.toEqual([
      "a",
      "b",
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 2,
    });
  });

  it("deletes the listed ids that are still past the cutoff", async () => {
    const cutoff = new Date("2026-04-20T12:00:00.000Z");
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const repository = new AuthAuditRepository({
      authAuditEvent: { deleteMany },
    } as any);

    await expect(repository.deleteByIds(["a", "b"], cutoff)).resolves.toBe(1);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, createdAt: { lt: cutoff } },
    });
  });

  it("lists one user's events newest first, filtered by type", async () => {
    const findMany = jest.fn(async () => []);
    const repository = new AuthAuditRepository({
      authAuditEvent: { findMany },
    } as any);

    await repository.listForUser({
      userId: USER_1_ID,
      eventTypes: ["logout", "session.revoked"],
      limit: 21,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: USER_1_ID,
        eventType: { in: ["logout", "session.revoked"] },
      },
      select: expect.objectContaining({ id: true, createdAt: true }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
    const select = (findMany.mock.calls[0] as any[])[0].select;
    expect(select).not.toHaveProperty("identifierHash");
    expect(select).not.toHaveProperty("requestId");
    expect(select).not.toHaveProperty("metadata");
  });

  it("filters by outcome", async () => {
    const findMany = jest.fn(async () => []);
    const repository = new AuthAuditRepository({
      authAuditEvent: { findMany },
    } as any);

    await repository.listForUser({
      userId: USER_1_ID,
      outcome: "failure",
      limit: 5,
    });

    expect((findMany.mock.calls[0] as any[])[0].where).toEqual({
      userId: USER_1_ID,
      outcome: "failure",
    });
  });

  it("bounds created_at by the date range, either side optional", async () => {
    const findMany = jest.fn(async () => []);
    const repository = new AuthAuditRepository({
      authAuditEvent: { findMany },
    } as any);
    const from = new Date("2026-10-01T04:00:00.000Z");
    const before = new Date("2026-10-08T04:00:00.000Z");

    await repository.listForUser({
      userId: USER_1_ID,
      createdFrom: from,
      createdBefore: before,
      limit: 5,
    });
    await repository.listForUser({
      userId: USER_1_ID,
      createdBefore: before,
      limit: 5,
    });

    expect((findMany.mock.calls[0] as any[])[0].where).toEqual({
      userId: USER_1_ID,
      createdAt: { gte: from, lt: before },
    });
    expect((findMany.mock.calls[1] as any[])[0].where).toEqual({
      userId: USER_1_ID,
      createdAt: { lt: before },
    });
  });

  it("checks the cursor row against the same filters, then starts after it", async () => {
    const findFirst = jest.fn(async () => ({ id: "event-9" }));
    const findMany = jest.fn(async () => []);
    const repository = new AuthAuditRepository({
      authAuditEvent: { findFirst, findMany },
    } as any);

    await expect(
      repository.listForUser({
        userId: USER_1_ID,
        outcome: "failure",
        afterId: "event-9",
        limit: 3,
      }),
    ).resolves.toEqual([]);

    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: USER_1_ID, outcome: "failure", id: "event-9" },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_1_ID, outcome: "failure" },
        cursor: { id: "event-9" },
        skip: 1,
        take: 3,
      }),
    );
  });

  it("returns null without listing when the cursor row is not the caller's under these filters", async () => {
    const findFirst = jest.fn(async () => null);
    const findMany = jest.fn(async () => []);
    const repository = new AuthAuditRepository({
      authAuditEvent: { findFirst, findMany },
    } as any);

    await expect(
      repository.listForUser({
        userId: USER_1_ID,
        afterId: "someone-elses-event",
        limit: 3,
      }),
    ).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
  describe("listForAdmin", () => {
    const from = new Date("2026-10-11T00:00:00.000Z");
    const before = new Date("2026-10-18T00:00:00.000Z");

    it("searches across users with every filter and a bounded range", async () => {
      const findMany = jest.fn(async () => []);
      const repository = new AuthAuditRepository({
        authAuditEvent: { findMany },
      } as any);

      await repository.listForAdmin({
        userId: USER_1_ID,
        ipAddress: "203.0.113.7",
        eventTypes: ["login.failed", "login.locked"],
        outcome: "failure",
        flagged: true,
        createdFrom: from,
        createdBefore: before,
        limit: 26,
      });

      expect(findMany).toHaveBeenCalledWith({
        where: {
          userId: USER_1_ID,
          ipAddress: "203.0.113.7",
          eventType: { in: ["login.failed", "login.locked"] },
          outcome: "failure",
          flagged: true,
          createdAt: { gte: from, lt: before },
        },
        select: expect.objectContaining({
          requestId: true,
          metadata: true,
          flagged: true,
          userAgent: true,
        }),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 26,
      });
      const select = (findMany.mock.calls[0] as any[])[0].select;
      expect(select).not.toHaveProperty("identifierHash");
    });

    it("filters by identifier hash and range alone", async () => {
      const findMany = jest.fn(async () => []);
      const repository = new AuthAuditRepository({
        authAuditEvent: { findMany },
      } as any);

      await repository.listForAdmin({
        identifierHash: "b".repeat(64),
        createdFrom: from,
        createdBefore: before,
        limit: 5,
      });

      expect((findMany.mock.calls[0] as any[])[0].where).toEqual({
        identifierHash: "b".repeat(64),
        createdAt: { gte: from, lt: before },
      });
    });

    it("rejects a cursor that names no event under the same filters", async () => {
      const findFirst = jest.fn(async () => null);
      const findMany = jest.fn(async () => []);
      const repository = new AuthAuditRepository({
        authAuditEvent: { findFirst, findMany },
      } as any);

      await expect(
        repository.listForAdmin({
          ipAddress: "203.0.113.7",
          afterId: "event-9",
          createdFrom: from,
          createdBefore: before,
          limit: 5,
        }),
      ).resolves.toBeNull();

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          ipAddress: "203.0.113.7",
          createdAt: { gte: from, lt: before },
          id: "event-9",
        },
        select: { id: true },
      });
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  it("counts one user's events of the given types since a time", async () => {
    const count = jest.fn(async () => 4);
    const repository = new AuthAuditRepository({
      authAuditEvent: { count },
    } as any);
    const since = new Date("2026-10-17T00:00:00.000Z");

    await expect(
      repository.countForUser({
        userId: USER_1_ID,
        eventTypes: ["login.failed", "oauth.login.failed"],
        createdFrom: since,
      }),
    ).resolves.toBe(4);

    expect(count).toHaveBeenCalledWith({
      where: {
        userId: USER_1_ID,
        eventType: { in: ["login.failed", "oauth.login.failed"] },
        createdAt: { gte: since },
      },
    });
  });

  it("finds a detection rule's recent event ids by user or by IP", async () => {
    const findMany = jest.fn(async () => [
      { id: "event-2" },
      { id: "event-1" },
    ]);
    const repository = new AuthAuditRepository({
      authAuditEvent: { findMany },
    } as any);
    const since = new Date("2026-10-26T11:50:00.000Z");

    await expect(
      repository.findRecentEventIds({
        userId: USER_1_ID,
        matches: [
          { eventType: "login.failed", outcome: "failure" },
          { eventType: "login.locked", triggeredLockout: true },
        ],
        createdFrom: since,
        limit: 50,
      }),
    ).resolves.toEqual(["event-2", "event-1"]);
    await repository.findRecentEventIds({
      ipAddress: "198.51.100.23",
      requestId: "request-1",
      matches: [{ eventType: "device.new_detected" }],
      createdFrom: since,
      limit: 1,
    });

    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: {
        userId: USER_1_ID,
        createdAt: { gte: since },
        OR: [
          { eventType: "login.failed", outcome: "failure" },
          {
            eventType: "login.locked",
            metadata: { path: "$.triggered", equals: true },
          },
        ],
      },
      select: { id: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          ipAddress: "198.51.100.23",
          requestId: "request-1",
          createdAt: { gte: since },
          OR: [{ eventType: "device.new_detected" }],
        },
        take: 1,
      }),
    );
  });

  it("flags only events not already flagged, and skips an empty list", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const repository = new AuthAuditRepository({
      authAuditEvent: { updateMany },
    } as any);

    await expect(repository.flagEvents(["event-1", "event-2"])).resolves.toBe(
      1,
    );
    await expect(repository.flagEvents([])).resolves.toBe(0);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["event-1", "event-2"] }, flagged: false },
      data: { flagged: true },
    });
  });
});
