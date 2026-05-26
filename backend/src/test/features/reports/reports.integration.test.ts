import { Hono } from "hono";
import { mountRoutes } from "@/configuration/bootstrap/routes";
import { buildApiPath } from "@/configuration/http/api-path";
import {
  containerTokens,
  type ServiceContainer,
} from "@/configuration/bootstrap/container";
import type { AppBindings } from "@/configuration/http/bindings";
import { clientContextMiddleware } from "@/configuration/middlewares/client-context.middleware";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { outputFormatMiddleware } from "@/configuration/middlewares/output-format.middleware";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { ReportsController } from "@/features/reports/reports.controller";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 1,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "report-1",
    reporterId: "user-1",
    subjectType: "posting",
    subjectId: "posting-1",
    reasonCode: "spam",
    title: "Looks suspicious",
    description: "This listing asks for payment outside the platform.",
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    reporter: {
      id: "user-1",
      email: "user@example.com",
      role: "user",
    },
    subjectSnapshot: {
      subjectType: "posting",
      summaryText: "Posting snapshot",
    },
    ...overrides,
  };
}

class FakeRequestContainer implements ServiceContainer {
  private readonly contentSanitizationService =
    new ContentSanitizationService();

  constructor(
    private readonly reportsController: ReportsController,
    private readonly tokenService: {
      verifyAccessToken(token: string): Promise<JwtClaims>;
    },
  ) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.reportsController) {
      return this.reportsController as TValue;
    }

    if (token === containerTokens.tokenService) {
      return this.tokenService as TValue;
    }

    if (token === containerTokens.contentSanitizationService) {
      return this.contentSanitizationService as TValue;
    }

    throw new Error("Unsupported test container token.");
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

function createApp() {
  const reportsService = {
    create: jest.fn(async () => createReport()),
    listModeration: jest.fn(async () => ({
      reports: [createReport()],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "database" as const,
    })),
    getModerationDetail: jest.fn(async () => ({
      ...createReport(),
      events: [],
    })),
    assign: jest.fn(async () => createReport()),
    updateStatus: jest.fn(async () =>
      createReport({
        status: "under_review",
      }),
    ),
  };

  const controller = new ReportsController(reportsService as never);
  const tokenService = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === "user-token") {
        return createClaims();
      }

      if (token === "moderator-token") {
        return createClaims({
          sub: "moderator-1",
          email: "moderator@example.com",
          role: "moderator",
        });
      }

      throw new Error("Invalid access token signature.");
    }),
  };
  const container = new FakeRequestContainer(controller, tokenService);
  const app = new Hono<AppBindings>();

  app.use("*", clientContextMiddleware);
  app.use("*", async (context, next) => {
    context.set("container", container);
    await next();
  });
  app.use("*", outputFormatMiddleware);
  app.onError(handleApplicationError);
  mountRoutes(app);

  return {
    app,
    reportsService,
  };
}

describe("Reports integration", () => {
  it("submits a report for authenticated users", async () => {
    const { app, reportsService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/reports")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subjectType: "posting",
          subjectId: "posting-1",
          reasonCode: "spam",
          title: "Looks suspicious",
          description: "This listing asks for payment outside the platform.",
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(reportsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: "user-1",
        subjectType: "posting",
      }),
    );
  });

  it("enforces moderator access for moderation queue routes", async () => {
    const { app, reportsService } = createApp();

    const forbiddenResponse = await app.request(
      `http://rent.test${buildApiPath("/moderation/reports")}`,
      {
        headers: {
          authorization: "Bearer user-token",
        },
      },
    );
    const moderatorResponse = await app.request(
      `http://rent.test${buildApiPath("/moderation/reports")}`,
      {
        headers: {
          authorization: "Bearer moderator-token",
        },
      },
    );

    expect(forbiddenResponse.status).toBe(403);
    expect(moderatorResponse.status).toBe(200);
    expect(reportsService.listModeration).toHaveBeenCalled();
  });

  it("updates moderation status for moderator-authenticated requests", async () => {
    const { app, reportsService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/moderation/reports/report-1/status")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer moderator-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: "under_review",
          note: "Escalating for manual review.",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(reportsService.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "moderator-1",
        actorRole: "moderator",
        reportId: "report-1",
        status: "under_review",
      }),
    );
  });
});
