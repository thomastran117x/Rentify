import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppBindings } from "@/configuration/http/bindings";
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

function readIdempotencyKeyHeader(
  context: Pick<Context<AppBindings>, "req">,
): string | null {
  const primary = normalizeKey(context.req.header(IDEMPOTENCY_KEY_HEADER_NAME));
  const legacy = normalizeKey(
    context.req.header(LEGACY_IDEMPOTENCY_KEY_HEADER_NAME),
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
  context: Context<AppBindings>,
  override?: string | null,
): string {
  const normalizedOverride = normalizeKey(override);

  if (normalizedOverride) {
    return normalizedOverride;
  }

  const contextKey = normalizeKey(context.get("idempotencyKey"));
  if (contextKey) {
    return contextKey;
  }

  const headerKey = readIdempotencyKeyHeader(context);
  if (headerKey) {
    return validateIdempotencyKey(headerKey);
  }

  const requestId =
    normalizeKey(context.get("requestId")) ??
    normalizeKey(context.req.header(REQUEST_ID_HEADER_NAME));
  if (requestId) {
    return validateRequestId(requestId);
  }

  return randomUUID();
}

export const idempotencyMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    const key = resolveIdempotencyKey(context);
    context.set("idempotencyKey", key);

    try {
      await next();
    } finally {
      context.header(IDEMPOTENCY_KEY_HEADER_NAME, key);
    }
  },
);
