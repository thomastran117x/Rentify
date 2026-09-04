import { RequestValidationError } from "@/configuration/validation/request";
import BadRequestError from "@/errors/http/bad-request.error";
import { FeedbacksController } from "@/features/feedbacks/feedbacks.controller";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { invokeHandler } from "../../support/mock-http";
import { testUuid } from "../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

const mockGetOptionalJwtAuth = jest.fn();
const mockResolveIdempotencyKey = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

jest.mock("@/configuration/middlewares/idempotency.middleware", () => ({
  resolveIdempotencyKey: (...args: unknown[]) =>
    mockResolveIdempotencyKey(...args),
}));

function createAuth(
  overrides: Partial<JwtAuthPrincipal> = {},
): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: USER_1_ID,
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 1,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function invoke(
  controller: FeedbacksController,
  body?: unknown,
): ReturnType<typeof invokeHandler> {
  return invokeHandler(
    (request, response) => controller.create(request, response),
    {
      body,
      state: {
        container: {
          resolve: () => ({
            inspectRequest: () => [],
          }),
        },
        client: {
          ip: "127.0.0.1",
          device: {
            id: "device-1",
          },
        },
        requestId: "request-1",
      },
    },
  );
}

describe("FeedbacksController", () => {
  beforeEach(() => {
    mockGetOptionalJwtAuth.mockReset();
    mockResolveIdempotencyKey.mockReset();
    mockResolveIdempotencyKey.mockReturnValue("feedback-idempotency-key");
  });

  it("accepts authenticated submissions without captcha", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(createAuth());
    const create = jest.fn(async () => ({
      id: "feedback-1",
      category: "feature_request",
      createdAt: "2026-06-15T12:00:00.000Z",
    }));
    const verify = jest.fn();
    const controller = new FeedbacksController(
      {
        create,
      } as any,
      {
        verify,
      } as any,
    );

    const response = await invoke(controller, {
      name: "Taylor Morgan",
      email: "taylor@example.com",
      category: "feature_request",
      message: "Please add saved searches to the renter flow.",
    });

    expect(create).toHaveBeenCalledWith({
      userId: USER_1_ID,
      name: "Taylor Morgan",
      email: "taylor@example.com",
      category: "feature_request",
      message: "Please add saved searches to the renter flow.",
    });
    expect(verify).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
  });

  it("requires captcha for anonymous submissions and forwards verification context", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(null);
    const create = jest.fn(async () => ({
      id: "feedback-1",
      category: "bug_report",
      createdAt: "2026-06-15T12:00:00.000Z",
    }));
    const verify = jest.fn(async () => ({
      success: true,
      failOpen: false,
      errors: [],
    }));
    const controller = new FeedbacksController(
      {
        create,
      } as any,
      {
        verify,
      } as any,
    );

    await invoke(controller, {
      name: "Taylor Morgan",
      email: "taylor@example.com",
      category: "bug_report",
      message: "The contact page submits twice on mobile Safari.",
      captchaToken: "turnstile-token",
    });

    expect(verify).toHaveBeenCalledWith({
      token: "turnstile-token",
      remoteIp: "127.0.0.1",
      idempotencyKey: "feedback-idempotency-key",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: undefined,
        category: "bug_report",
      }),
    );
  });

  it("rejects anonymous submissions without captcha", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(null);
    const controller = new FeedbacksController({} as any, {} as any);

    await expect(
      invoke(controller, {
        name: "Taylor Morgan",
        email: "taylor@example.com",
        category: "praise",
        message: "The booking workspace feels much easier to use now.",
      }),
    ).rejects.toBeInstanceOf(RequestValidationError);
  });

  it("rejects captcha failures for anonymous submissions", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(null);
    const verify = jest.fn(async () => ({
      success: false,
      failOpen: false,
      errors: ["invalid-input-response"],
    }));
    const controller = new FeedbacksController(
      {} as any,
      {
        verify,
      } as any,
    );

    await expect(
      invoke(controller, {
        name: "Taylor Morgan",
        email: "taylor@example.com",
        category: "usability",
        message: "The saved filters disappear when navigating back.",
        captchaToken: "bad-token",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
