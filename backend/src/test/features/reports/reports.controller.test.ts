import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { RequestValidationError } from "@/configuration/validation/request";
import ForbiddenError from "@/errors/http/forbidden.error";
import { ReportsController } from "@/features/reports/reports.controller";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";

const mockRequireSessionAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

function createAuth(
  overrides: Partial<JwtAuthPrincipal> = {},
): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: "moderator-1",
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
  const context = {
    req: {
      json: async () => options?.body ?? {},
      url:
        options?.url ??
        "https://example.test/reports/moderation?page=2&pageSize=5",
      param: (name?: string) =>
        name ? options?.params?.[name] : (options?.params ?? {}),
    },
    get: () => ({
      resolve: () => ({
        inspectRequest: () => [],
      }),
    }),
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
        },
      }),
  };

  return context as unknown as Context<AppBindings>;
}

describe("ReportsController", () => {
  beforeEach(() => {
    mockRequireSessionAuth.mockReset();
  });

  it("creates reports with trimmed fields and the authenticated reporter id", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth({ sub: "user-1", role: "user" }),
    });
    const create = jest.fn(async () => ({
      id: "report-1",
    }));
    const controller = new ReportsController({
      create,
    } as never);

    const response = await controller.create(
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
      reporterId: "user-1",
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
    } as never);

    const response = await controller.listModeration(
      createContext({
        url: "https://example.test/reports/moderation?page=2&pageSize=5&q=spam&status=open&subjectType=posting&reasonCode=fraud_or_scam&assignedTo=moderator-1&reporterId=user-1&sort=newest",
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
      assignedTo: "moderator-1",
      reporterId: "user-1",
      sort: "newest",
    });
    expect(response.status).toBe(200);
    expect(payload.meta.source).toBe("database");
  });

  it("rejects invalid moderation list queries with a request validation error", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth(),
    });
    const controller = new ReportsController({} as never);

    await expect(
      controller.listModeration(
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
    const controller = new ReportsController({} as never);

    await expect(
      controller.listModeration(createContext()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("loads moderation report detail by route id", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth({ role: "admin" }),
    });
    const getModerationDetail = jest.fn(async () => ({
      id: "report-1",
    }));
    const controller = new ReportsController({
      getModerationDetail,
    } as never);

    const response = await controller.getModerationById(
      createContext({
        params: {
          id: "report-1",
        },
      }),
    );

    expect(getModerationDetail).toHaveBeenCalledWith("report-1");
    expect(response.status).toBe(200);
  });

  it("assigns a report using the moderator context and optional assignee", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth({ sub: "moderator-1", role: "moderator" }),
    });
    const assign = jest.fn(async () => ({
      id: "report-1",
    }));
    const controller = new ReportsController({
      assign,
    } as never);

    const response = await controller.assign(
      createContext({
        params: {
          id: "report-1",
        },
        body: {
          assignedModeratorId: "moderator-2",
        },
      }),
    );

    expect(assign).toHaveBeenCalledWith({
      actorUserId: "moderator-1",
      actorRole: "moderator",
      reportId: "report-1",
      assignedModeratorId: "moderator-2",
    });
    expect(response.status).toBe(200);
  });

  it("updates a report status through the moderation service", async () => {
    mockRequireSessionAuth.mockResolvedValue({
      ...createAuth({ sub: "admin-1", role: "admin" }),
    });
    const updateStatus = jest.fn(async () => ({
      id: "report-1",
    }));
    const controller = new ReportsController({
      updateStatus,
    } as never);

    const response = await controller.updateStatus(
      createContext({
        params: {
          id: "report-1",
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
      actorUserId: "admin-1",
      actorRole: "admin",
      reportId: "report-1",
      status: "resolved",
      resolutionCode: "action_taken",
      resolutionSummary: "Listing removed",
      note: "Escalated and resolved",
    });
    expect(response.status).toBe(200);
  });
});
