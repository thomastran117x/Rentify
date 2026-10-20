import { AuthAuditActivityService } from "@/features/auth/audit/auth-audit-activity.service";
import {
  decodeActivityCursor,
  encodeActivityCursor,
} from "@/features/auth/audit/auth-audit-activity";
import type { AuthAuditActivityRow } from "@/features/auth/audit/auth-audit.model";
import type { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import type { DeviceRepository } from "@/features/auth/device/device.repository";
import { RequestValidationError } from "@/configuration/validation/request";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 425101);

function createRow(index: number): AuthAuditActivityRow {
  return {
    id: testUuid(9100, index),
    userId: USER_ID,
    actorUserId: null,
    eventType: "login.succeeded",
    outcome: "success",
    reasonCode: null,
    method: "password",
    ipAddress: "203.0.113.24",
    userAgent: null,
    deviceId: `device-${index}`,
    sessionId: `session-${index}`,
    createdAt: new Date(Date.UTC(2026, 9, 18, 12, 0, 60 - index)),
  };
}

function createService(rows: AuthAuditActivityRow[], deviceIds: string[] = []) {
  const repository = {
    listForUser: jest.fn(async () => rows),
  };
  const deviceRepository = {
    listKnownDevices: jest.fn(async () =>
      deviceIds.map((deviceId) => ({ deviceId })),
    ),
  };

  return {
    repository,
    deviceRepository,
    service: new AuthAuditActivityService(
      repository as unknown as AuthAuditRepository,
      deviceRepository as unknown as DeviceRepository,
    ),
  };
}

describe("AuthAuditActivityService.listForUser", () => {
  it("returns a page and a cursor pointing at its last item when more remain", async () => {
    const rows = [createRow(1), createRow(2), createRow(3)];
    const { service, repository } = createService(rows);

    const result = await service.listForUser({ userId: USER_ID, limit: 2 });

    expect(repository.listForUser).toHaveBeenCalledWith({
      userId: USER_ID,
      eventTypes: undefined,
      afterId: undefined,
      limit: 3,
    });
    expect(result.items.map((item) => item.id)).toEqual([
      rows[0].id,
      rows[1].id,
    ]);
    expect(decodeActivityCursor(result.nextCursor!)).toBe(rows[1].id);
  });

  it("returns a null cursor on the last page", async () => {
    const { service } = createService([createRow(1)]);

    const result = await service.listForUser({ userId: USER_ID, limit: 2 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("returns an empty page with a null cursor", async () => {
    const { service } = createService([]);

    await expect(
      service.listForUser({ userId: USER_ID, limit: 20 }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("passes the outcome filter through", async () => {
    const { service, repository } = createService([]);

    await service.listForUser({
      userId: USER_ID,
      limit: 5,
      outcome: "blocked",
    });

    expect(repository.listForUser).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "blocked" }),
    );
  });

  it("passes the date range as created_at bounds", async () => {
    const { service, repository } = createService([]);

    await service.listForUser({
      userId: USER_ID,
      limit: 5,
      from: "2026-10-01T00:00:00-04:00",
      to: "2026-10-08T04:00:00.000Z",
    });

    expect(repository.listForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        createdFrom: new Date("2026-10-01T04:00:00.000Z"),
        createdBefore: new Date("2026-10-08T04:00:00.000Z"),
      }),
    );
  });

  it("decodes the cursor and maps the category to its event types", async () => {
    const afterId = testUuid(9100, 99);
    const { service, repository } = createService([]);

    await service.listForUser({
      userId: USER_ID,
      limit: 5,
      category: "sessions",
      cursor: encodeActivityCursor(afterId),
    });

    expect(repository.listForUser).toHaveBeenCalledWith({
      userId: USER_ID,
      eventTypes: [
        "logout",
        "session.revoked",
        "session.refresh_reuse_detected",
        "device.new_detected",
      ],
      afterId,
      limit: 6,
    });
  });

  it("rejects a cursor the repository does not accept for these filters", async () => {
    const { service, repository } = createService([]);
    repository.listForUser.mockResolvedValueOnce(null as never);

    await expect(
      service.listForUser({
        userId: USER_ID,
        limit: 5,
        cursor: encodeActivityCursor(testUuid(9100, 98)),
      }),
    ).rejects.toBeInstanceOf(RequestValidationError);
  });

  it("rejects a malformed cursor before querying", async () => {
    const { service, repository } = createService([]);

    await expect(
      service.listForUser({ userId: USER_ID, limit: 5, cursor: "bogus" }),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(repository.listForUser).not.toHaveBeenCalled();
  });

  it("flags the current session and known devices, matching the stored id width", async () => {
    const longDeviceId = "d".repeat(80);
    const known = { ...createRow(1), deviceId: longDeviceId.slice(0, 64) };
    const { service, deviceRepository } = createService(
      [known, createRow(2)],
      [longDeviceId],
    );

    const result = await service.listForUser({
      userId: USER_ID,
      sessionId: "session-2",
      limit: 20,
    });

    expect(deviceRepository.listKnownDevices).toHaveBeenCalledWith(USER_ID);
    expect(
      result.items.map((item) => [item.deviceKnown, item.current]),
    ).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});
