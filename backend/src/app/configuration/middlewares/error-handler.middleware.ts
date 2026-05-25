import AppError from "@/errors/http/app.error";
import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { buildErrorResponse } from "@/configuration/http/responses";
import { loggerFactory } from "@/configuration/logging";
import { RequestValidationError } from "@/configuration/validation/request";
import { detectOutputFormat, serializeToXml } from "./output-format.middleware";

const errorLogger = loggerFactory.forComponent(
  "error-handler.middleware",
  "middleware",
);

export function handleApplicationError(
  error: unknown,
  context: Context<AppBindings>,
): Response {
  const { status, body } = toErrorResponse(error);
  const responseBody = buildErrorResponse(context, body);
  const outputFormat =
    context.var.outputFormat ?? detectOutputFormat(context.req.raw);
  const headers = new Headers(context.res?.headers);

  if (status >= 500) {
    const requestLogger = context.get("logger");
    (requestLogger ?? errorLogger).error(
      "Unhandled application error.",
      undefined,
      error,
    );
  }

  if (outputFormat === "xml") {
    headers.set("content-type", "application/xml; charset=UTF-8");

    return new Response(serializeToXml(responseBody, "errorResponse"), {
      status,
      headers,
    });
  }

  headers.set("content-type", "application/json; charset=UTF-8");

  return new Response(JSON.stringify(responseBody), {
    status,
    headers,
  });
}

export function toErrorResponse(error: unknown): {
  status: number;
  body: {
    message: string;
    code: string;
    details?: unknown;
  };
} {
  if (error instanceof RequestValidationError) {
    return {
      status: error.status,
      body: {
        message: error.message,
        code: "VALIDATION_ERROR",
        details: toValidationErrorDetails(error),
      },
    };
  }

  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        message: error.message,
        code: error.code,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }

  return {
    status: 500,
    body: {
      message: "Internal server error.",
      code: "INTERNAL_SERVER_ERROR",
    },
  };
}

function toValidationErrorDetails(
  error: RequestValidationError,
): Record<string, string[]> {
  const details: Record<string, string[]> = {};

  for (const issue of error.details) {
    const key = issue.path || "root";

    if (!details[key]) {
      details[key] = [];
    }

    details[key].push(issue.message);
  }

  return details;
}
