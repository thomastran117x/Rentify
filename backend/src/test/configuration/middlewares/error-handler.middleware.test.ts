import BadRequestError from "@/errors/http/bad-request.error";
import BadGatewayError from "@/errors/http/bad-gateway.error";
import MfaConfirmRateLimitedError from "@/errors/http/mfa-confirm-rate-limited.error";
import MfaFactorUnavailableError from "@/errors/http/mfa-factor-unavailable.error";
import {
  handleApplicationError,
  toErrorResponse,
} from "@/configuration/middlewares/error-handler.middleware";
import { RequestValidationError } from "@/configuration/validation/request";
import type { AppBindings } from "@/configuration/http/bindings";
import type { Context } from "hono";

function createContext(options?: {
  requestId?: string;
  outputFormat?: "json" | "xml";
  accept?: string;
}) {
  const variables = new Map<string, unknown>();
  const logger = {
    error: jest.fn(),
  };

  if (options?.requestId) {
    variables.set("requestId", options.requestId);
  }

  variables.set("logger", logger);

  const context = {
    req: {
      raw: new Request("http://rent.test/errors", {
        headers: options?.accept
          ? {
              accept: options.accept,
            }
          : undefined,
      }),
    },
    res: {
      headers: new Headers(),
    },
    var: {
      outputFormat: options?.outputFormat,
    },
    get: (name: string) => variables.get(name),
    set: (name: string, value: unknown) => {
      variables.set(name, value);
    },
  };

  return {
    context: context as unknown as Context<AppBindings>,
    logger,
  };
}

describe("error-handler.middleware", () => {
  it("returns app error status, code, and details without logging", async () => {
    const { context, logger } = createContext({
      requestId: "req-app-error",
    });
    const response = handleApplicationError(
      new BadRequestError("Refund amount is invalid.", {
        field: "amount",
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=UTF-8",
    );
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Refund amount is invalid.",
      data: null,
      error: {
        code: "BAD_REQUEST",
        details: {
          field: "amount",
        },
      },
      meta: {
        requestId: "req-app-error",
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("formats request validation errors with grouped field details", async () => {
    const { context, logger } = createContext({
      requestId: "req-validation",
    });
    const response = handleApplicationError(
      new RequestValidationError("Request body validation failed.", [
        {
          path: "page",
          message: "Too small: expected number to be >=1",
        },
        {
          path: "pageSize",
          message: "Too big: expected number to be <=50",
        },
        {
          path: "page",
          message: "Page must be an integer.",
        },
      ]),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Request body validation failed.",
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        details: {
          page: [
            "Too small: expected number to be >=1",
            "Page must be an integer.",
          ],
          pageSize: ["Too big: expected number to be <=50"],
        },
      },
      meta: {
        requestId: "req-validation",
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("masks unexpected runtime errors, avoids leaking internal details, and logs them", async () => {
    const { context, logger } = createContext({
      requestId: "req-runtime",
    });
    const runtimeError = new Error(
      "Prisma connection to postgres://admin:secret@db.internal failed",
    );
    runtimeError.stack =
      "Error: Prisma connection failed\n    at internal/server.ts:42:13";

    const response = handleApplicationError(runtimeError, context);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=UTF-8",
    );
    expect(body).toContain('"message":"Internal server error."');
    expect(body).toContain('"code":"INTERNAL_SERVER_ERROR"');
    expect(body).toContain('"requestId":"req-runtime"');
    expect(body).not.toContain("Prisma connection");
    expect(body).not.toContain("postgres://admin:secret@db.internal");
    expect(body).not.toContain("internal/server.ts");
    expect(logger.error).toHaveBeenCalledWith(
      "Unhandled application error.",
      undefined,
      runtimeError,
    );
  });

  it("renders xml error bodies when xml output is requested", async () => {
    const { context, logger } = createContext({
      requestId: "req-xml",
      outputFormat: "xml",
    });
    const response = handleApplicationError(
      new BadRequestError("Webhook signature is invalid.", {
        provider: "square",
      }),
      context,
    );
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=UTF-8",
    );
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain("<message>Webhook signature is invalid.</message>");
    expect(body).toContain("<code>BAD_REQUEST</code>");
    expect(body).toContain("<provider>square</provider>");
    expect(body).toContain("<requestId>req-xml</requestId>");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("maps unknown values to a generic internal server error envelope", () => {
    expect(toErrorResponse("plain failure")).toEqual({
      status: 500,
      body: {
        message: "Internal server error.",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  });

  it("maps BadGatewayError to a 502 envelope", () => {
    const error = new BadGatewayError("Upstream failed.", {
      provider: "stripe",
    });
    expect(toErrorResponse(error)).toMatchObject({
      status: 502,
      body: { code: "BAD_GATEWAY", message: "Upstream failed." },
    });
  });

  it("maps MfaConfirmRateLimitedError to a 429 envelope with the default message", () => {
    const error = new MfaConfirmRateLimitedError();
    expect(toErrorResponse(error)).toMatchObject({
      status: 429,
      body: { code: "MFA_CONFIRM_RATE_LIMITED" },
    });
  });

  it("maps MfaFactorUnavailableError to a 400 envelope with the default message", () => {
    const error = new MfaFactorUnavailableError();
    expect(toErrorResponse(error)).toMatchObject({
      status: 400,
      body: { code: "MFA_FACTOR_UNAVAILABLE" },
    });
  });
});
