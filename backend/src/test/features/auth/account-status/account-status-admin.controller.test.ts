import { AccountStatusAdminController } from "@/features/auth/account-status/account-status-admin.controller";
import type { AccountStatusService } from "@/features/auth/account-status/account-status.service";
import ForbiddenError from "@/errors/http/forbidden.error";
import { RequestValidationError } from "@/configuration/validation/request";
import {
  createClaims,
  createContext,
  invoke,
} from "../../../support/auth-controller-harness";
import { testUuid } from "../../../support/uuid";

const ADMIN_ID = testUuid(9000, 377301);
const USER_ID = testUuid(9000, 377302);
const REASON = "Reported account takeover";

const mockRequireSessionAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

function createController() {
  const result = {
    userId: USER_ID,
    status: "locked",
    statusReason: REASON,
    statusChangedAt: "2026-10-21T09:00:00.000Z",
    statusChangedBy: ADMIN_ID,
    changed: true,
  };
  const accountStatusService = {
    lock: jest.fn(async () => result),
    suspend: jest.fn(async () => ({ ...result, status: "suspended" })),
    reinstate: jest.fn(async () => ({ ...result, status: "active" })),
  };

  return {
    accountStatusService,
    controller: new AccountStatusAdminController(
      accountStatusService as unknown as AccountStatusService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireSessionAuth.mockResolvedValue(
    createClaims({ sub: ADMIN_ID, role: "admin" }),
  );
});

describe("AccountStatusAdminController", () => {
  it.each(["lock", "suspend", "reinstate"] as const)(
    "%s passes the trimmed reason, the acting admin and the request context",
    async (action) => {
      const { controller, accountStatusService } = createController();

      const response = await invoke(
        controller[action],
        createContext({
          params: { id: USER_ID },
          body: { reason: `  ${REASON}  ` },
        }),
      );

      expect(response.status).toBe(200);
      expect(accountStatusService[action]).toHaveBeenCalledWith(USER_ID, {
        reason: REASON,
        source: "admin",
        actorUserId: ADMIN_ID,
        context: {
          ipAddress: "127.0.0.1",
          userAgent: "test-agent",
          deviceId: "device-1",
          requestId: "request-test",
        },
      });
      expect((await response.json()).data).toMatchObject({ userId: USER_ID });
    },
  );

  it.each(["user", "owner", "moderator"] as const)(
    "forbids a %s before reading the body",
    async (role) => {
      const { controller, accountStatusService } = createController();
      mockRequireSessionAuth.mockResolvedValue(
        createClaims({ sub: ADMIN_ID, role }),
      );

      await expect(
        invoke(
          controller.lock,
          createContext({ params: { id: USER_ID }, body: {} }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(accountStatusService.lock).not.toHaveBeenCalled();
    },
  );

  it("forbids an admin from changing their own status", async () => {
    const { controller, accountStatusService } = createController();

    await expect(
      invoke(
        controller.suspend,
        createContext({ params: { id: ADMIN_ID }, body: { reason: REASON } }),
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "You cannot change your own account status.",
    });
    expect(accountStatusService.suspend).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing reason", {}],
    ["a reason under five characters", { reason: "   bad " }],
    ["a reason over 255 characters", { reason: "x".repeat(256) }],
    ["an unknown field", { reason: REASON, notify: true }],
  ])("rejects %s", async (_label, body) => {
    const { controller, accountStatusService } = createController();

    await expect(
      invoke(controller.lock, createContext({ params: { id: USER_ID }, body })),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(accountStatusService.lock).not.toHaveBeenCalled();
  });

  it("rejects an account id that is not a UUID", async () => {
    const { controller, accountStatusService } = createController();

    await expect(
      invoke(
        controller.reinstate,
        createContext({
          params: { id: "not-a-uuid" },
          body: { reason: REASON },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(accountStatusService.reinstate).not.toHaveBeenCalled();
  });
});
