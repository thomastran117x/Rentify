import { AuthAuditController } from "@/features/auth/audit/auth-audit.controller";
import type { AuthAuditActivityService } from "@/features/auth/audit/auth-audit-activity.service";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { RequestValidationError } from "@/configuration/validation/request";
import {
  createClaims,
  createContext,
  invoke,
} from "../../../support/auth-controller-harness";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 425201);
const OTHER_USER_ID = testUuid(9000, 425202);

const mockRequireRecentMfaVerification = jest.fn();

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
}));

function createController() {
  const activityService = {
    listForUser: jest.fn(async () => ({ items: [], nextCursor: null })),
  };
  const mfaVerificationService = {} as MfaVerificationService;

  return {
    activityService,
    mfaVerificationService,
    controller: new AuthAuditController(
      activityService as unknown as AuthAuditActivityService,
      mfaVerificationService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireRecentMfaVerification.mockResolvedValue(
    createClaims({ sub: USER_ID, sessionId: "session-1" }),
  );
});

describe("AuthAuditController.listMine", () => {
  it("lists the verified caller's activity with the parsed query", async () => {
    const { controller, activityService, mfaVerificationService } =
      createController();

    const response = await invoke(
      controller.listMine,
      createContext({
        url: "https://example.test/auth/audit/me?limit=5&category=sign_in&cursor=abc",
      }),
    );

    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    expect(activityService.listForUser).toHaveBeenCalledWith({
      limit: 5,
      category: "sign_in",
      cursor: "abc",
      userId: USER_ID,
      sessionId: "session-1",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { items: [], nextCursor: null },
    });
  });

  it("rejects a user id in the query instead of honouring it", async () => {
    const { controller, activityService } = createController();

    await expect(
      invoke(
        controller.listMine,
        createContext({
          url: `https://example.test/auth/audit/me?userId=${OTHER_USER_ID}`,
        }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(activityService.listForUser).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range limit", async () => {
    const { controller } = createController();

    await expect(
      invoke(
        controller.listMine,
        createContext({ url: "https://example.test/auth/audit/me?limit=500" }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
  });

  it("stops when the session or step-up check fails", async () => {
    mockRequireRecentMfaVerification.mockRejectedValue(
      new UnauthorizedError("Authentication required."),
    );
    const { controller, activityService } = createController();

    await expect(
      invoke(controller.listMine, createContext()),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(activityService.listForUser).not.toHaveBeenCalled();
  });
});
