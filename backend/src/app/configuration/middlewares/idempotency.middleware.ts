import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { getHeader } from "@/configuration/http/request";
import {
  toRequest,
  type RequestLike,
} from "@/configuration/http/legacy-context";
import BadRequestError from "@/errors/http/bad-request.error";
import {
  REQUEST_ID_HEADER_NAME,
  validateRequestId,
} from "./request-id.middleware";

const IDEMPOTENCY_KEY_HEADER_NAME = "idempotency-key";
const LEGACY_IDEMPOTENCY_KEY_HEADER_NAME = "x-idempotency-key";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;

function normalizeKey(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function validateIdempotencyKey(value: string): string {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new BadRequestError("Idempotency key header is invalid.", {
      headers: [
        IDEMPOTENCY_KEY_HEADER_NAME,
        LEGACY_IDEMPOTENCY_KEY_HEADER_NAME,
      ],
    });
  }

  return value;
}

function readIdempotencyKeyHeader(request: Request): string | null {
  const primary = normalizeKey(getHeader(request, IDEMPOTENCY_KEY_HEADER_NAME));
  const legacy = normalizeKey(
    getHeader(request, LEGACY_IDEMPOTENCY_KEY_HEADER_NAME),
  );

  if (primary && legacy && primary !== legacy) {
    throw new BadRequestError(
      "Conflicting idempotency key headers were provided.",
      {
        headers: [
          IDEMPOTENCY_KEY_HEADER_NAME,
          LEGACY_IDEMPOTENCY_KEY_HEADER_NAME,
        ],
      },
    );
  }

  return primary ?? legacy;
}

export function resolveIdempotencyKey(
  source: RequestLike,
  override?: string | null,
): string {
  const request = toRequest(source);
  const normalizedOverride = normalizeKey(override);

  if (normalizedOverride) {
    return normalizedOverride;
  }

  const contextKey = normalizeKey(request.idempotencyKey);
  if (contextKey) {
    return contextKey;
  }

  const headerKey = readIdempotencyKeyHeader(request);
  if (headerKey) {
    return validateIdempotencyKey(headerKey);
  }

  const requestId =
    normalizeKey(request.requestId) ??
    normalizeKey(getHeader(request, REQUEST_ID_HEADER_NAME));
  if (requestId) {
    return validateRequestId(requestId);
  }

  return randomUUID();
}

export const idempotencyMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  // As with the request id, the echoed header is set up front instead of in a
  // `finally`, so it is on the response before any handler starts writing.
  const key = resolveIdempotencyKey(request);
  request.idempotencyKey = key;
  response.setHeader(IDEMPOTENCY_KEY_HEADER_NAME, key);

  next();
};
