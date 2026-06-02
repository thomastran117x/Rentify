import { createMiddleware } from "hono/factory";
import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import { stripApiRoutePrefix } from "@/configuration/http/api-path";
import type { AppBindings } from "@/configuration/http/bindings";
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

function readDeclaredContentLength(request: Request): number | null {
  const value = request.headers.get("content-length");

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
    request.headers.has("transfer-encoding") ||
    request.headers.has("content-type")
  );
}

function isJsonContentType(contentType: string | null): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  return (
    normalized.includes("application/json") || normalized.includes("+json")
  );
}

function allowsNonJsonBody(request: Request): boolean {
  try {
    const pathname = stripApiRoutePrefix(new URL(request.url).pathname);
    return pathname === "/blob/upload";
  } catch {
    return false;
  }
}

async function assertRequestBodySizeWithinLimit(
  request: Request,
  maxBytes: number,
  declaredContentLength: number | null,
): Promise<void> {
  if (declaredContentLength !== null) {
    if (declaredContentLength > maxBytes) {
      throw new PayloadTooLargeError("Request body is too large.", {
        limitBytes: maxBytes,
        receivedBytes: declaredContentLength,
      });
    }

    return;
  }

  const bodySize = (await request.clone().arrayBuffer()).byteLength;

  if (bodySize > maxBytes) {
    throw new PayloadTooLargeError("Request body is too large.", {
      limitBytes: maxBytes,
      receivedBytes: bodySize,
    });
  }
}

export const requestBodyPolicyMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    const request = context.req.raw;
    const declaredContentLength = readDeclaredContentLength(request);

    if (!requestHasBody(request, declaredContentLength)) {
      await next();
      return;
    }

    if (
      !isJsonContentType(request.headers.get("content-type")) &&
      !allowsNonJsonBody(request)
    ) {
      throw new UnsupportedMediaTypeError(
        "Request body must use application/json.",
      );
    }

    await assertRequestBodySizeWithinLimit(
      request,
      readRequestBodyMaxBytes(),
      declaredContentLength,
    );
    await next();
  },
);
