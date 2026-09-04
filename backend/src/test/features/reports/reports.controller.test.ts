import { createTestContext, invoke } from "../../support/mock-http";
import { RequestValidationError } from "@/configuration/validation/request";
import ForbiddenError from "@/errors/http/forbidden.error";
import { ReportsController } from "@/features/reports/reports.controller";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { testUuid } from "../../support/uuid";
const ADMIN_1_ID = testUuid(9000, 185107);

const REPORT_ID = testUuid(4400, 1);
const MODERATOR_ONE_ID = testUuid(1000, 91);
const MODERATOR_TWO_ID = testUuid(1000, 92);
const REPORTER_ID = testUuid(1000, 93);

const mockRequireSessionAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

function createAuth(
  overrides: Partial<JwtAuthPrincipal> = {},
): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: MODERATOR_ONE_ID,
    email: "moderator@example.com",
    role: "moderator",
    deviceId: "device-1",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createContext(options?: {
  body?: unknown;
  url?: string;
  params?: Record<string, string>;
}) {
  return createTestContext({
    body: options?.body,
    params: options?.params,
    url:
      options?.url ??
      "https://example.test/reports/moderation?page=2&pageSize=5",
    state: {
      container: {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      },
    },
  });
}

describe("ReportsController", () => {
  beforeEach(() => {
    mockRequireSessionAuth.mockReset();
  });

  it("creates reports with trimmed fields and the authenticated reporter id", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth({ sub: REPORTER_ID, role: "user" }),
    });
    const create = jest.fn(async () => ({
      id: REPORT_ID,
    }));
    const controller = new ReportsController({
      create,
    } as any);

    const response = await invoke(
      controller.create,
      createContext({
        body: {
          subjectType: "posting",
          subjectId: "posting-1",
          reasonCode: "spam",
          title: "  Suspicious listing  ",
          description: "  Asking for off-platform payment.  ",
        },
      }),
    );

    expect(create).toHaveBeenCalledWith({
      reporterId: REPORTER_ID,
      subjectType: "posting",
      subjectId: "posting-1",
      reasonCode: "spam",
      title: "Suspicious listing",
      description: "Asking for off-platform payment.",
    });
    expect(response.status).toBe(201);
  });

  it("parses moderation list query params and returns pagination metadata", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth(),
    });
    const listModeration = jest.fn(async () => ({
      reports: [],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 9,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      source: "database",
    }));
    const controller = new ReportsController({
      listModeration,
    } as any);

    const response = await invoke(
      controller.listModeration,
      createContext({
        url: `https://example.test/reports/moderation?page=2&pageSize=5&q=spam&status=open&subjectType=posting&reasonCode=fraud_or_scam&assignedTo=${MODERATOR_ONE_ID}&reporterId=${REPORTER_ID}&sort=newest`,
      }),
    );
    const payload = await response.json();

    expect(listModeration).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      q: "spam",
      status: "open",
      subjectType: "posting",
      reasonCode: "fraud_or_scam",
      assignedTo: MODERATOR_ONE_ID,
      reporterId: REPORTER_ID,
      sort: "newest",
    });
    expect(response.status).toBe(200);
    expect(payload.meta.source).toBe("database");
  });

  it("rejects invalid moderation list queries with a request validation error", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth(),
    });
    const controller = new ReportsController({} as any);

    await expect(
      invoke(
        controller.listModeration,
        createContext({
          url: "https://example.test/reports/moderation?page=0&pageSize=500",
        }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
  });

  it("forbids moderation access for non-moderator roles", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth({ role: "user" }),
    });
    const controller = new ReportsController({} as any);

    await expect(
      invoke(controller.listModeration, createContext()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("loads moderation report detail by route id", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth({ role: "admin" }),
    });
    const getModerationDetail = jest.fn(async () => ({
      id: REPORT_ID,
    }));
    const controller = new ReportsController({
      getModerationDetail,
    } as any);

    const response = await invoke(
      controller.getModerationById,
      createContext({
        params: {
          id: REPORT_ID,
        },
      }),
    );

    expect(getModerationDetail).toHaveBeenCalledWith(REPORT_ID);
    expect(response.status).toBe(200);
  });

  it("assigns a report using the moderator context and optional assignee", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth({ sub: MODERATOR_ONE_ID, role: "moderator" }),
    });
    const assign = jest.fn(async () => ({
      id: REPORT_ID,
    }));
    const controller = new ReportsController({
      assign,
    } as any);

    const response = await invoke(
      controller.assign,
      createContext({
        params: {
          id: REPORT_ID,
        },
        body: {
          assignedModeratorId: MODERATOR_TWO_ID,
        },
      }),
    );

    expect(assign).toHaveBeenCalledWith({
      actorUserId: MODERATOR_ONE_ID,
      actorRole: "moderator",
      reportId: REPORT_ID,
      assignedModeratorId: MODERATOR_TWO_ID,
    });
    expect(response.status).toBe(200);
  });

  it("updates a report status through the moderation service", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth({ sub: ADMIN_1_ID, role: "admin" }),
    });
    const updateStatus = jest.fn(async () => ({
      id: REPORT_ID,
    }));
    const controller = new ReportsController({
      updateStatus,
    } as any);

    const response = await invoke(
      controller.updateStatus,
      createContext({
        params: {
          id: REPORT_ID,
        },
        body: {
          status: "resolved",
          resolutionCode: "action_taken",
          resolutionSummary: "Listing removed",
          note: "Escalated and resolved",
        },
      }),
    );

    expect(updateStatus).toHaveBeenCalledWith({
      actorUserId: ADMIN_1_ID,
      actorRole: "admin",
      reportId: REPORT_ID,
      status: "resolved",
      resolutionCode: "action_taken",
      resolutionSummary: "Listing removed",
      note: "Escalated and resolved",
    });
    expect(response.status).toBe(200);
  });
});
