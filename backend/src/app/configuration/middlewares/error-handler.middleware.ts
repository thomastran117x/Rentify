import AppError from "@/errors/http/app.error";
import type { ErrorRequestHandler } from "express";
import { buildErrorResponse } from "@/configuration/http/responses";
import {
  getContentType,
  writeSerializedBody,
} from "./output-format.middleware";
import { loggerFactory } from "@/configuration/logging";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import { readRequestBodyMaxBytes } from "./request-body-policy.middleware";
import { RequestValidationError } from "@/configuration/validation/request";
import { detectOutputFormat, serializeToXml } from "./output-format.middleware";

const errorLogger = loggerFactory.forComponent(
  "error-handler.middleware",
  "middleware",
);

/**
 * Terminal error middleware.
 *
 * Express identifies this as an error handler by its arity, so all four
 * parameters have to stay even though `next` is only used for the
 * headers-already-sent case. Express 5 forwards rejected promises from async
 * handlers here automatically, which is what replaces Hono's `app.onError`.
 */
export const handleApplicationError: ErrorRequestHandler = (
  error,
  request,
  response,
  next,
) => {
  // Nothing can be changed once the status line is on the wire; handing back to
  // Express lets it close the connection.
  if (response.headersSent) {
    next(error);
    return;
  }

  const { status, body } = toErrorResponse(error);
  const responseBody = buildErrorResponse(request.requestId, body);
  const outputFormat = request.outputFormat ?? detectOutputFormat(request);

  if (status >= 500) {
    const requestLogger = request.logger;
    (requestLogger ?? errorLogger).error(
      "Unhandled application error.",
      undefined,
      error,
    );
  }

  // Serialised directly rather than through res.json, both because the XML root
  // element differs from the success one and because res.json is wrapped by the
  // output-format middleware, which would apply the success root.
  response.status(status);

  if (outputFormat === "xml") {
    writeSerializedBody(
      response,
      getContentType("xml"),
      serializeToXml(responseBody, "errorResponse"),
    );
    return;
  }

  writeSerializedBody(
    response,
    getContentType("json"),
    JSON.stringify(responseBody),
  );
};

/**
 * Body parsers raise their own errors for a payload that is too large or is not
 * valid JSON. Both cases were previously owned by our own middleware, so they
 * are translated back to keep the wire responses identical.
 */
function normalizeBodyParserError(error: unknown): unknown {
  if (!(error instanceof Error) || !("type" in error)) {
    return error;
  }

  if (error.type === "entity.too.large") {
    return new PayloadTooLargeError("Request body is too large.", {
      limitBytes: readRequestBodyMaxBytes(),
    });
  }

  if (error.type === "entity.parse.failed") {
    return new RequestValidationError("Request body must be valid JSON.", []);
  }

  return error;
}

export function toErrorResponse(rawError: unknown): {
  status: number;
  body: {
    message: string;
    code: string;
    details?: unknown;
  };
} {
  const error = normalizeBodyParserError(rawError);

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
