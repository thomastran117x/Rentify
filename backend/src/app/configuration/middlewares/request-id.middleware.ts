import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { getHeader } from "@/configuration/http/request";
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
    getHeader(request, REQUEST_ID_HEADER_NAME),
  );

  if (!requestId) {
    return randomUUID();
  }

  return validateRequestId(requestId);
}

export const requestIdMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  // Set before next() rather than after: the header only has to be on the
  // response, and once a handler starts writing it is too late to add one.
  // An invalid incoming id throws first, so the header is skipped in that case
  // just as it was under Hono.
  const requestId = resolveRequestId(request);
  request.requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER_NAME, requestId);

  next();
};
