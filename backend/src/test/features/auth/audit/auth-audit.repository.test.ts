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
      },
    });
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
});
