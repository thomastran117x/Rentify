import type { Response as ExpressResponse } from "express";

export interface ApiResponseMeta {
  requestId: string;
  pagination?: unknown;
  [key: string]: unknown;
}

export interface ApiErrorPayload<TDetails = unknown> {
  code: string;
  details?: TDetails;
}

export interface ApiEnvelope<TData = unknown, TErrorDetails = unknown> {
  success: boolean;
  message: string;
  data: TData | null;
  error: ApiErrorPayload<TErrorDetails> | null;
  meta: ApiResponseMeta;
}

interface ResponseOptions {
  message?: string;
  meta?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRequestId(requestId: string | undefined): string {
  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : "unknown";
}

function defaultSuccessMessage(status: 200 | 201 | 202): string {
  switch (status) {
    case 201:
      return "Resource created successfully.";
    case 202:
      return "Request accepted successfully.";
    case 200:
    default:
      return "Request completed successfully.";
  }
}

export function mergeResponseMeta(
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const merged = Object.assign(
    {},
    ...sources.filter((source) => source !== undefined),
  );
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function paginationMeta(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value) || !("pagination" in value)) {
    return undefined;
  }

  return {
    pagination: value.pagination,
  };
}

export function pickMeta<TKeys extends string>(
  value: unknown,
  keys: readonly TKeys[],
): Partial<Record<TKeys, unknown>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const meta: Partial<Record<TKeys, unknown>> = {};

  for (const key of keys) {
    if (key in value) {
      meta[key] = value[key];
    }
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * The envelope builders take a request id rather than a framework object, so
 * they can be shared by handlers and by the error middleware, which only has an
 * Express response to hand.
 */
export function buildResponseMeta(
  requestId: string | undefined,
  meta?: Record<string, unknown>,
): ApiResponseMeta {
  return {
    requestId: resolveRequestId(requestId),
    ...(meta ?? {}),
  };
}

export function buildSuccessResponse<TData>(
  requestId: string | undefined,
  data: TData,
  status: 200 | 201 | 202,
  options: ResponseOptions = {},
): ApiEnvelope<TData> {
  return {
    success: true,
    message: options.message ?? defaultSuccessMessage(status),
    data,
    error: null,
    meta: buildResponseMeta(requestId, options.meta),
  };
}

export function buildErrorResponse<TDetails>(
  requestId: string | undefined,
  input: {
    message: string;
    code: string;
    details?: TDetails;
    meta?: Record<string, unknown>;
  },
): ApiEnvelope<null, TDetails> {
  return {
    success: false,
    message: input.message,
    data: null,
    error: {
      code: input.code,
      ...(input.details !== undefined ? { details: input.details } : {}),
    },
    meta: buildResponseMeta(requestId, input.meta),
  };
}

function jsonResponse<TData>(
  response: ExpressResponse,
  status: 200 | 201 | 202,
  data: TData,
  options?: ResponseOptions,
): void {
  response
    .status(status)
    .json(buildSuccessResponse(response.req.requestId, data, status, options));
}

export function ok<TData>(
  response: ExpressResponse,
  data: TData,
  options?: ResponseOptions,
): void {
  jsonResponse(response, 200, data, options);
}

export function created<TData>(
  response: ExpressResponse,
  data: TData,
  options?: ResponseOptions,
): void {
  jsonResponse(response, 201, data, options);
}

export function accepted<TData>(
  response: ExpressResponse,
  data: TData,
  options?: ResponseOptions,
): void {
  jsonResponse(response, 202, data, options);
}

export function noContent(response: ExpressResponse): void {
  response.status(204).end();
}
