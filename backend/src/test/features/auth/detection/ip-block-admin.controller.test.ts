import { AuthIpBlockAdminController } from "@/features/auth/detection/ip-block-admin.controller";
import type { AuthIpBlockAdminService } from "@/features/auth/detection/ip-block-admin.service";
import ForbiddenError from "@/errors/http/forbidden.error";
import { RequestValidationError } from "@/configuration/validation/request";
import {
  createClaims,
  createContext,
  invoke,
} from "../../../support/auth-controller-harness";
import { testUuid } from "../../../support/uuid";

const ADMIN_ID = testUuid(9000, 379401);
const USER_ID = testUuid(9000, 379402);

const mockRequireSessionAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

const READER = {
  userId: ADMIN_ID,
  context: {
    ipAddress: "127.0.0.1",
    userAgent: "test-agent",
    deviceId: "device-1",
    requestId: "request-test",
  },
};

function createController() {
  const adminService = {
    listBlocks: jest.fn(async () => ({
      items: [
        { ipAddress: "198.51.100.41", expiresAt: "2026-10-26T13:00:00.000Z" },
      ],
    })),
    unblock: jest.fn(async () => undefined),
  };

  return {
    adminService,
    controller: new AuthIpBlockAdminController(
      adminService as unknown as AuthIpBlockAdminService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireSessionAuth.mockResolvedValue(
    createClaims({ sub: ADMIN_ID, role: "admin" }),
  );
});

describe("AuthIpBlockAdminController", () => {
  it("lists the blocks for an admin", async () => {
    const { controller, adminService } = createController();

    const response = await invoke(controller.listBlocks, createContext());

    expect(response.status).toBe(200);
    expect(adminService.listBlocks).toHaveBeenCalledWith(READER);
    expect((await response.json()).data).toEqual({
      items: [
        { ipAddress: "198.51.100.41", expiresAt: "2026-10-26T13:00:00.000Z" },
      ],
    });
  });

  it.each(["198.51.100.41", "2001:db8::1", " 198.51.100.41 "])(
    "lifts the block on %j with a 204",
    async (ip) => {
      const { controller, adminService } = createController();

      const response = await invoke(
        controller.unblock,
        createContext({ params: { ip } }),
      );

      expect(response.status).toBe(204);
      expect(adminService.unblock).toHaveBeenCalledWith(ip.trim(), READER);
    },
  );

  it("rejects an address that is not an IP", async () => {
    const { controller, adminService } = createController();

    await expect(
      invoke(
        controller.unblock,
        createContext({ params: { ip: "example.com" } }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(adminService.unblock).not.toHaveBeenCalled();
  });

  it.each(["user", "owner", "moderator"])(
    "rejects a %s before looking at the address",
    async (role) => {
      mockRequireSessionAuth.mockResolvedValue(
        createClaims({ sub: USER_ID, role: role as never }),
      );
      const { controller, adminService } = createController();

      await expect(
        invoke(controller.listBlocks, createContext()),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        invoke(
          controller.unblock,
          createContext({ params: { ip: "not an ip" } }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(adminService.listBlocks).not.toHaveBeenCalled();
      expect(adminService.unblock).not.toHaveBeenCalled();
    },
  );
});
