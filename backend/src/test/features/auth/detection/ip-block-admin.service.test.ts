import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { AuthIpBlockAdminService } from "@/features/auth/detection/ip-block-admin.service";
import { testUuid } from "../../../support/uuid";

const ADMIN_ID = testUuid(9000, 379501);
const READER = {
  userId: ADMIN_ID,
  context: { ipAddress: "127.0.0.1", requestId: "request-1" },
};
const BLOCK = {
  ipAddress: "198.51.100.41",
  expiresAt: "2026-10-26T13:00:00.000Z",
};

function createService() {
  const calls: string[] = [];
  const ipBlockStore = {
    list: jest.fn(async () => {
      calls.push("list");
      return [BLOCK];
    }),
    clear: jest.fn(async () => true),
  };
  const authAuditService = {
    record: jest.fn(async () => {
      calls.push("record");
    }),
    recordSafely: jest.fn(async () => undefined),
  };

  return {
    calls,
    ipBlockStore,
    authAuditService,
    service: new AuthIpBlockAdminService(ipBlockStore, authAuditService),
  };
}

describe("AuthIpBlockAdminService", () => {
  it("records the read before listing the blocks", async () => {
    const { service, calls, authAuditService } = createService();

    await expect(service.listBlocks(READER)).resolves.toEqual({
      items: [BLOCK],
    });
    expect(calls).toEqual(["record", "list"]);
    expect(authAuditService.record).toHaveBeenCalledWith({
      eventType: "admin.audit_viewed",
      outcome: "success",
      userId: null,
      actorUserId: ADMIN_ID,
      context: READER.context,
      metadata: { view: "ip_blocks" },
    });
  });

  it("lists nothing when the read cannot be recorded", async () => {
    const { service, ipBlockStore, authAuditService } = createService();
    authAuditService.record.mockRejectedValueOnce(new Error("database down"));

    await expect(service.listBlocks(READER)).rejects.toThrow("database down");
    expect(ipBlockStore.list).not.toHaveBeenCalled();
  });

  it("lifts a block and records who did it", async () => {
    const { service, ipBlockStore, authAuditService } = createService();

    await service.unblock("198.51.100.41", READER);

    expect(ipBlockStore.clear).toHaveBeenCalledWith("198.51.100.41");
    expect(authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "admin.ip_unblocked",
      outcome: "success",
      userId: null,
      actorUserId: ADMIN_ID,
      context: READER.context,
      metadata: { ipAddress: "198.51.100.41" },
    });
  });

  it("is a 404 for an address that is not blocked, recording nothing", async () => {
    const { service, ipBlockStore, authAuditService } = createService();
    ipBlockStore.clear.mockResolvedValueOnce(false);

    await expect(
      service.unblock("198.51.100.41", READER),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(authAuditService.recordSafely).not.toHaveBeenCalled();
  });
});
