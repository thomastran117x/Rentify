import type { Request, RequestHandler } from "express";
import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import { stripApiRoutePrefix } from "@/configuration/http/api-path";
import { getHeader, getPathname } from "@/configuration/http/request";
import BadRequestError from "@/errors/http/bad-request.error";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import UnsupportedMediaTypeError from "@/errors/http/unsupported-media-type.error";

const DEFAULT_REQUEST_BODY_MAX_BYTES = 1024 * 1024;
const REQUEST_BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readRequestBodyMaxBytes(): number {
  const configuredValue = getOptionalEnvironmentVariable(
    "REQUEST_BODY_MAX_BYTES",
  );

  if (!configuredValue) {
    return DEFAULT_REQUEST_BODY_MAX_BYTES;
  }

  const parsedValue = Number(configuredValue);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return DEFAULT_REQUEST_BODY_MAX_BYTES;
  }

  return parsedValue;
}

export function readDeclaredContentLength(request: Request): number | null {
  const value = getHeader(request, "content-length");

  if (!value) {
    return null;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new BadRequestError("Content-Length header is invalid.");
  }

  return parsedValue;
}

function requestHasBody(
  request: Request,
  declaredContentLength: number | null,
): boolean {
  if (!REQUEST_BODY_METHODS.has(request.method.toUpperCase())) {
    return false;
  }

  if (declaredContentLength !== null) {
    return declaredContentLength > 0;
  }

  return (
    getHeader(request, "transfer-encoding") !== undefined ||
    getHeader(request, "content-type") !== undefined
  );
}

function isJsonContentType(contentType: string | null): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  return (
    normalized.includes("application/json") || normalized.includes("+json")
  );
}

export function allowsNonJsonBody(request: Request): boolean {
  try {
    return stripApiRoutePrefix(getPathname(request)) === "/blob/upload";
  } catch {
    return false;
  }
}

function assertDeclaredBodySizeWithinLimit(
  maxBytes: number,
  declaredContentLength: number | null,
): void {
  if (declaredContentLength === null || declaredContentLength <= maxBytes) {
    return;
  }

  throw new PayloadTooLargeError("Request body is too large.", {
    limitBytes: maxBytes,
    receivedBytes: declaredContentLength,
  });
}

/**
 * Runs before the body parsers so an oversized or wrongly typed request is
 * rejected without reading the payload.
 *
 * The Hono version buffered the body itself when no Content-Length was
 * declared. Under Express that job belongs to the body parsers, which are
 * configured with the same limit; their `entity.too.large` is translated back
 * into PayloadTooLargeError in the error handler, so the wire response is the
 * same either way.
 */
export const requestBodyPolicyMiddleware: RequestHandler = (
  request,
  _response,
  next,
) => {
  const declaredContentLength = readDeclaredContentLength(request);

  if (!requestHasBody(request, declaredContentLength)) {
    next();
    return;
  }

  if (
    !isJsonContentType(getHeader(request, "content-type") ?? null) &&
    !allowsNonJsonBody(request)
  ) {
    throw new UnsupportedMediaTypeError(
      "Request body must use application/json.",
    );
  }

  assertDeclaredBodySizeWithinLimit(
    readRequestBodyMaxBytes(),
    declaredContentLength,
  );

  next();
};

export { readRequestBodyMaxBytes };
