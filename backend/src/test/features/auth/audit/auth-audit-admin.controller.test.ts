import { AuthAuditAdminController } from "@/features/auth/audit/auth-audit-admin.controller";
import type { AuthAuditAdminService } from "@/features/auth/audit/auth-audit-admin.service";
import ForbiddenError from "@/errors/http/forbidden.error";
import { RequestValidationError } from "@/configuration/validation/request";
import {
  createClaims,
  createContext,
  invoke,
} from "../../../support/auth-controller-harness";
import { testUuid } from "../../../support/uuid";

const ADMIN_ID = testUuid(9000, 376301);
const USER_ID = testUuid(9000, 376302);

const mockRequireSessionAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

function createController() {
  const adminService = {
    listEvents: jest.fn(async () => ({
      items: [],
      nextCursor: null,
      range: { from: "a", to: "b" },
    })),
    getUserSecuritySummary: jest.fn(async () => ({ accountStatus: "active" })),
  };

  return {
    adminService,
    controller: new AuthAuditAdminController(
      adminService as unknown as AuthAuditAdminService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireSessionAuth.mockResolvedValue(
    createClaims({ sub: ADMIN_ID, role: "admin" }),
  );
});

describe("AuthAuditAdminController.listEvents", () => {
  it("passes every repeated event type and the reader's request context", async () => {
    const { controller, adminService } = createController();

    const response = await invoke(
      controller.listEvents,
      createContext({
        url: "https://example.test/admin/auth/audit?eventType=login.failed&eventType=login.locked&ip=203.0.113.7&limit=10",
      }),
    );

    expect(response.status).toBe(200);
    expect(adminService.listEvents).toHaveBeenCalledWith(
      {
        eventType: ["login.failed", "login.locked"],
        ip: "203.0.113.7",
        limit: 10,
      },
      {
        userId: ADMIN_ID,
        context: {
          ipAddress: "127.0.0.1",
          userAgent: "test-agent",
          deviceId: "device-1",
          requestId: "request-test",
        },
      },
    );
    expect((await response.json()).data).toEqual({
      items: [],
      nextCursor: null,
      range: { from: "a", to: "b" },
    });
  });

  it("accepts a single event type as a one-item list", async () => {
    const { controller, adminService } = createController();

    await invoke(
      controller.listEvents,
      createContext({
        url: "https://example.test/admin/auth/audit?eventType=logout",
      }),
    );

    expect(adminService.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: ["logout"] }),
      expect.anything(),
    );
  });

  it.each(["user", "owner", "moderator"])(
    "rejects a %s before looking at the query",
    async (role) => {
      mockRequireSessionAuth.mockResolvedValueOnce(
        createClaims({ sub: USER_ID, role: role as never }),
      );
      const { controller, adminService } = createController();

      await expect(
        invoke(
          controller.listEvents,
          createContext({
            url: "https://example.test/admin/auth/audit?bogus=1",
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(adminService.listEvents).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown query parameter for an admin", async () => {
    const { controller } = createController();

    await expect(
      invoke(
        controller.listEvents,
        createContext({
          url: "https://example.test/admin/auth/audit?identifierHash=abc",
        }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
  });
});

describe("AuthAuditAdminController.getUserSecurity", () => {
  it("returns the summary for a valid account id", async () => {
    const { controller, adminService } = createController();

    const response = await invoke(
      controller.getUserSecurity,
      createContext({ params: { id: USER_ID } }),
    );

    expect(response.status).toBe(200);
    expect(adminService.getUserSecuritySummary).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ userId: ADMIN_ID }),
    );
  });

  it("rejects a malformed id", async () => {
    const { controller, adminService } = createController();

    await expect(
      invoke(
        controller.getUserSecurity,
        createContext({ params: { id: "not-a-uuid" } }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(adminService.getUserSecuritySummary).not.toHaveBeenCalled();
  });

  it("rejects a moderator before validating the id", async () => {
    mockRequireSessionAuth.mockResolvedValueOnce(
      createClaims({ sub: USER_ID, role: "moderator" as never }),
    );
    const { controller } = createController();

    await expect(
      invoke(
        controller.getUserSecurity,
        createContext({ params: { id: "not-a-uuid" } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
