import BadRequestError from "@/errors/http/bad-request.error";
import BadGatewayError from "@/errors/http/bad-gateway.error";
import MfaConfirmRateLimitedError from "@/errors/http/mfa-confirm-rate-limited.error";
import MfaFactorUnavailableError from "@/errors/http/mfa-factor-unavailable.error";
import {
  handleApplicationError,
  toErrorResponse,
} from "@/configuration/middlewares/error-handler.middleware";
import { RequestValidationError } from "@/configuration/validation/request";
import type { Logger } from "@/configuration/logging";
import { createTestApp } from "../../support/fetch-app";

/**
 * The handler is an Express error middleware now, so it is exercised through a
 * real request rather than called directly and inspected.
 */
async function handle(
  error: unknown,
  options?: {
    requestId?: string;
    outputFormat?: "json" | "xml";
    accept?: string;
  },
): Promise<{ response: Response; logger: { error: jest.Mock } }> {
  const logger = { error: jest.fn() };

  const app = createTestApp((instance) => {
    instance.use((request, _response, next) => {
      if (options?.requestId) {
        request.requestId = options.requestId;
      }

      if (options?.outputFormat) {
        request.outputFormat = options.outputFormat;
      }

      request.logger = logger as unknown as Logger;
      next();
    });
    instance.get("/errors", () => {
      throw error;
    });
    instance.use(handleApplicationError);
  });

  const response = await app.request("http://rent.test/errors", {
    headers: options?.accept ? { accept: options.accept } : undefined,
  });

  return { response, logger };
}

describe("error-handler.middleware", () => {
  it("returns app error status, code, and details without logging", async () => {
    const { response, logger } = await handle(
      new BadRequestError("Refund amount is invalid.", {
        field: "amount",
      }),
      { requestId: "req-app-error" },
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
    const { response, logger } = await handle(
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
      { requestId: "req-validation" },
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
    const runtimeError = new Error(
      "Prisma connection to postgres://admin:secret@db.internal failed",
    );
    runtimeError.stack =
      "Error: Prisma connection failed\n    at internal/server.ts:42:13";

    const { response, logger } = await handle(runtimeError, {
      requestId: "req-runtime",
    });
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
    const { response, logger } = await handle(
      new BadRequestError("Webhook signature is invalid.", {
        provider: "square",
      }),
      { requestId: "req-xml", outputFormat: "xml" },
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

  it("negotiates xml from the accept header when no output format was resolved", async () => {
    const { response } = await handle(new BadRequestError("Nope."), {
      requestId: "req-accept-xml",
      accept: "application/xml",
    });

    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=UTF-8",
    );
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

  it("translates the body parser's oversized payload error", () => {
    const error = Object.assign(new Error("request entity too large"), {
      type: "entity.too.large",
    });

    expect(toErrorResponse(error)).toMatchObject({
      status: 413,
      body: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body is too large.",
      },
    });
  });

  it("translates the body parser's malformed json error", () => {
    const error = Object.assign(new SyntaxError("Unexpected token"), {
      type: "entity.parse.failed",
    });

    expect(toErrorResponse(error)).toMatchObject({
      status: 400,
      body: {
        code: "VALIDATION_ERROR",
        message: "Request body must be valid JSON.",
      },
    });
  });
});
