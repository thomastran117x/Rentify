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
import { FeedbacksController } from "@/features/feedbacks/feedbacks.controller";
import { FeedbacksRepository } from "@/features/feedbacks/feedbacks.repository";
import { FeedbacksService } from "@/features/feedbacks/feedbacks.service";
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

class FakeRequestContainer implements ServiceContainer {
  private readonly contentSanitizationService =
    new ContentSanitizationService();

  constructor(
    private readonly feedbacksController: FeedbacksController,
    private readonly tokenService: {
      verifyAccessToken(token: string): Promise<JwtClaims>;
    },
  ) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.feedbacksController) {
      return this.feedbacksController as TValue;
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
  const feedbackCreate = jest.fn(
    async ({
      data,
    }: {
      data: {
        userId?: string | null;
        name: string;
        email: string;
        category: string;
        message: string;
      };
    }) => ({
      id: "feedback-1",
      userId: data.userId ?? null,
      name: data.name,
      email: data.email,
      category: data.category,
      message: data.message,
      createdAt: new Date("2026-06-15T12:00:00.000Z"),
      updatedAt: new Date("2026-06-15T12:00:00.000Z"),
    }),
  );
  const feedbacksRepository = new FeedbacksRepository({
    feedback: {
      create: feedbackCreate,
    },
  } as never);
  const feedbacksService = new FeedbacksService(feedbacksRepository);
  const captchaService = {
    verify: jest.fn(async ({ token }: { token?: string }) => ({
      success: token === "turnstile-token",
      failOpen: false,
      errors: token === "turnstile-token" ? [] : ["invalid-input-response"],
    })),
  };
  const controller = new FeedbacksController(
    feedbacksService,
    captchaService as never,
  );
  const tokenService = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === "user-token") {
        return createClaims();
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
    feedbackCreate,
    captchaService,
  };
}

describe("Feedbacks integration", () => {
  it("persists anonymous feedback after captcha verification", async () => {
    const { app, feedbackCreate, captchaService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/feedback")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Taylor Morgan",
          email: "taylor@example.com",
          category: "feature_request",
          message: "Please add saved searches to the renter flow.",
          captchaToken: "turnstile-token",
        }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(captchaService.verify).toHaveBeenCalled();
    expect(feedbackCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: null,
        category: "feature_request",
      }),
    });
    expect(payload.data).toEqual({
      id: "feedback-1",
      category: "feature_request",
      createdAt: "2026-06-15T12:00:00.000Z",
    });
  });

  it("accepts authenticated feedback without captcha", async () => {
    const { app, feedbackCreate, captchaService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/feedback")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Taylor Morgan",
          email: "taylor@example.com",
          category: "bug_report",
          message: "The contact page submits twice on mobile Safari.",
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(captchaService.verify).not.toHaveBeenCalled();
    expect(feedbackCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        category: "bug_report",
      }),
    });
  });

  it("rejects anonymous feedback without captcha", async () => {
    const { app, feedbackCreate, captchaService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/feedback")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Taylor Morgan",
          email: "taylor@example.com",
          category: "praise",
          message: "The booking workspace feels much easier to use now.",
        }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.details).toEqual({
      captchaToken: ["Captcha token is required."],
    });
    expect(captchaService.verify).not.toHaveBeenCalled();
    expect(feedbackCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid anonymous captcha submissions", async () => {
    const { app, feedbackCreate } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/feedback")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Taylor Morgan",
          email: "taylor@example.com",
          category: "usability",
          message: "The saved filters disappear when navigating back.",
          captchaToken: "bad-token",
        }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("BAD_REQUEST");
    expect(payload.message).toBe("Captcha verification failed.");
    expect(feedbackCreate).not.toHaveBeenCalled();
  });
});
