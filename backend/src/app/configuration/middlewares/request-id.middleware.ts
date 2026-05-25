import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { AppBindings } from "@/configuration/http/bindings";
import BadRequestError from "@/errors/http/bad-request.error";

export const REQUEST_ID_HEADER_NAME = "x-request-id";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function normalizeRequestId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function validateRequestId(value: string): string {
  if (!REQUEST_ID_PATTERN.test(value)) {
    throw new BadRequestError("x-request-id header is invalid.", {
      header: REQUEST_ID_HEADER_NAME,
    });
  }

  return value;
}

export function resolveRequestId(request: Request): string {
  const requestId = normalizeRequestId(
    request.headers.get(REQUEST_ID_HEADER_NAME),
  );

  if (!requestId) {
    return randomUUID();
  }

  return validateRequestId(requestId);
}

export const requestIdMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    const requestId = resolveRequestId(context.req.raw);
    context.set("requestId", requestId);

    try {
      await next();
    } finally {
      context.header(REQUEST_ID_HEADER_NAME, requestId);
    }
  },
);
