import { resolveApiBaseUrl } from "@/lib/env";
import { getDeviceId, getDevicePlatform } from "@/lib/auth/device";
import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
} from "@/lib/auth/storage";
import type { AuthResponseBody } from "@/lib/auth/types";
import {
  ApiClientError,
  ApiError,
  ApiNetworkError,
  ApiProtocolError,
  ApiRateLimitError,
  ApiServerError,
  type ApiRequestContext,
  type ApiErrorResponse,
  type ApiResponse,
} from "@/lib/api/types";

export type JsonRequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RequestMode = "public" | "authenticated" | "optionalAuth";
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<string | number | boolean | null | undefined>;

interface JsonRequestOptions<TBody> {
  body?: TBody;
  headers?: Record<string, string>;
  method: JsonRequestMethod;
  mode: RequestMode;
  path: string;
  signal?: AbortSignal;
}

interface PerformJsonRequestOptions<TBody> extends JsonRequestOptions<TBody> {
  allowRefreshRetry: boolean;
  includeAuthorization: boolean;
}

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";
let refreshSessionPromise: Promise<AuthResponseBody | null> | null = null;
const UNKNOWN_REQUEST_CONTEXT: ApiRequestContext = {
  method: "GET",
  path: "unknown",
  requestUrl: "unknown",
};

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function readCsrfToken(): string | undefined {
  const token = readCookie(CSRF_COOKIE_NAME);
  return token ? decodeURIComponent(token) : undefined;
}

function shouldIncludeJsonContentType(
  method: JsonRequestMethod,
  body: unknown,
): boolean {
  return method !== "GET" && body !== undefined;
}

function toRequestUrl(path: string): string {
  return `${resolveApiBaseUrl()}${path}`;
}

function toRequestContext(
  options: Pick<JsonRequestOptions<unknown>, "method" | "mode" | "path">,
): ApiRequestContext {
  return {
    method: options.method,
    mode: options.mode,
    path: options.path,
    requestUrl: toRequestUrl(options.path),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && "name" in error && error.name === "AbortError";
}

function toNetworkError(
  request: ApiRequestContext,
  error: unknown,
): ApiNetworkError {
  return new ApiNetworkError("Unable to reach the server.", {
    code: "NETWORK_ERROR",
    request,
    cause: error,
  });
}

function isSharedFailureStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isClientFailureStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

function toUnreadableResponseError(
  response: Response,
  request: ApiRequestContext,
  error: unknown,
): ApiProtocolError | ApiServerError {
  const message = isSharedFailureStatus(response.status)
    ? "The server returned an unreadable response."
    : "The API returned an unreadable response.";
  const options = {
    cause: error,
    code: isSharedFailureStatus(response.status)
      ? "INVALID_SERVER_RESPONSE"
      : "INVALID_API_RESPONSE",
    details:
      error instanceof Error ? { causeMessage: error.message } : undefined,
    request,
    status: response.status,
  };

  return isSharedFailureStatus(response.status)
    ? new ApiServerError(message, options)
    : new ApiProtocolError(message, options);
}

function isApiErrorResponse(
  payload: unknown,
): payload is ApiErrorResponse<unknown> {
  if (!isRecord(payload)) {
    return false;
  }

  if ("success" in payload && payload.success !== false) {
    return false;
  }

  if (typeof payload.message !== "string") {
    return false;
  }

  if (!isRecord(payload.error) || typeof payload.error.code !== "string") {
    return false;
  }

  return true;
}

function shouldIncludeCsrfHeader(
  options: JsonRequestOptions<unknown>,
): boolean {
  if (!readCsrfToken()) {
    return false;
  }

  if (options.mode !== "public") {
    return true;
  }

  return options.path.startsWith("/auth/");
}

function buildRequestHeaders(
  options: JsonRequestOptions<unknown>,
  includeAuthorization: boolean,
): Record<string, string> {
  const deviceId = getDeviceId();
  const devicePlatform = getDevicePlatform();
  const session = readStoredSession();
  const csrfToken = readCsrfToken();

  return {
    accept: "application/json",
    ...(shouldIncludeJsonContentType(options.method, options.body)
      ? { "content-type": "application/json" }
      : {}),
    ...(includeAuthorization && session?.accessToken
      ? { authorization: `Bearer ${session.accessToken}` }
      : {}),
    ...(csrfToken && shouldIncludeCsrfHeader(options)
      ? { [CSRF_HEADER_NAME]: csrfToken }
      : {}),
    ...(deviceId ? { "x-device-id": deviceId } : {}),
    ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
    ...options.headers,
  };
}

export async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json();
}

async function readApiPayload(
  response: Response,
  request: ApiRequestContext,
): Promise<unknown> {
  try {
    return await readJson(response);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw toUnreadableResponseError(response, request, error);
  }
}

export function unwrapApiResponse<TData>(
  payload: unknown,
  request: ApiRequestContext = UNKNOWN_REQUEST_CONTEXT,
): TData {
  const response = payload as ApiResponse<TData> | null;

  if (
    !response ||
    typeof response !== "object" ||
    response.success !== true ||
    !("data" in response)
  ) {
    throw new ApiProtocolError(
      "API response payload did not include a valid data envelope.",
      {
        code: "INVALID_API_RESPONSE",
        details: payload ?? undefined,
        request,
      },
    );
  }

  return response.data;
}

export function toApiError(
  response: Response,
  payload: unknown,
  request: ApiRequestContext = UNKNOWN_REQUEST_CONTEXT,
): ApiError {
  if (!isApiErrorResponse(payload)) {
    const message = isSharedFailureStatus(response.status)
      ? "The server returned an invalid error response."
      : "The API returned an invalid error response.";
    const options = {
      code: isSharedFailureStatus(response.status)
        ? "INVALID_SERVER_RESPONSE"
        : "INVALID_API_RESPONSE",
      details: payload ?? undefined,
      request,
      status: response.status,
    };

    return isSharedFailureStatus(response.status)
      ? new ApiServerError(message, options)
      : new ApiProtocolError(message, options);
  }

  const options = {
    code: payload.error.code,
    details: payload.error.details,
    request,
    status: response.status,
  };

  if (response.status === 429) {
    return new ApiRateLimitError(payload.message, {
      ...options,
      status: 429,
    });
  }

  if (response.status >= 500) {
    return new ApiServerError(payload.message, options);
  }

  if (isClientFailureStatus(response.status)) {
    return new ApiClientError(payload.message, options);
  }

  return new ApiProtocolError("The API returned an unexpected status code.", {
    code: "INVALID_API_STATUS",
    details: {
      payload,
      status: response.status,
    },
    request,
    status: response.status,
  });
}

export function buildQuery<TParams extends object>(params: TParams): string {
  const searchParams = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(
    params as Record<string, QueryValue>,
  )) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const entry of rawValue) {
        if (entry === undefined || entry === null) {
          continue;
        }

        searchParams.append(key, String(entry));
      }
      continue;
    }

    searchParams.set(key, String(rawValue));
  }

  return searchParams.toString();
}

export function buildPathWithQuery<TParams extends object>(
  path: string,
  params: TParams,
): string {
  const query = buildQuery(params);
  return query ? `${path}?${query}` : path;
}

async function performJsonRequest<TResponse, TBody = undefined>(
  options: PerformJsonRequestOptions<TBody>,
): Promise<TResponse> {
  const request = toRequestContext(options);
  let response: Response;

  try {
    response = await fetch(request.requestUrl, {
      method: options.method,
      headers: buildRequestHeaders(options, options.includeAuthorization),
      credentials: "include",
      signal: options.signal,
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw toNetworkError(request, error);
  }

  if (
    response.status === 401 &&
    options.mode === "authenticated" &&
    options.allowRefreshRetry
  ) {
    const refreshedSession = await refreshStoredSession();

    if (refreshedSession) {
      return performJsonRequest<TResponse, TBody>({
        ...options,
        allowRefreshRetry: false,
        includeAuthorization: true,
      });
    }
  }

  if (
    response.status === 401 &&
    options.mode === "optionalAuth" &&
    options.includeAuthorization
  ) {
    return performJsonRequest<TResponse, TBody>({
      ...options,
      allowRefreshRetry: false,
      includeAuthorization: false,
    });
  }

  const payload = await readApiPayload(response, request);

  if (!response.ok) {
    throw toApiError(response, payload, request);
  }

  return unwrapApiResponse<TResponse>(payload, request);
}

export function publicJson<TResponse, TBody = undefined>(
  method: JsonRequestMethod,
  path: string,
  body?: TBody,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Promise<TResponse> {
  return performJsonRequest<TResponse, TBody>({
    allowRefreshRetry: false,
    body,
    headers,
    includeAuthorization: false,
    method,
    mode: "public",
    path,
    signal,
  });
}

export function authenticatedJson<TResponse, TBody = undefined>(
  method: JsonRequestMethod,
  path: string,
  body?: TBody,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Promise<TResponse> {
  return performJsonRequest<TResponse, TBody>({
    allowRefreshRetry: true,
    body,
    headers,
    includeAuthorization: true,
    method,
    mode: "authenticated",
    path,
    signal,
  });
}

export function optionalAuthJson<TResponse, TBody = undefined>(
  method: JsonRequestMethod,
  path: string,
  body?: TBody,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Promise<TResponse> {
  return performJsonRequest<TResponse, TBody>({
    allowRefreshRetry: false,
    body,
    headers,
    includeAuthorization: Boolean(readStoredSession()?.accessToken),
    method,
    mode: "optionalAuth",
    path,
    signal,
  });
}

export async function textRequest(
  path: string,
  headers?: Record<string, string>,
): Promise<string> {
  const request: ApiRequestContext = {
    method: "GET",
    mode: "public",
    path,
    requestUrl: toRequestUrl(path),
  };
  let response: Response;

  try {
    response = await fetch(request.requestUrl, {
      method: "GET",
      headers: {
        accept: "application/yaml, text/yaml, text/plain",
        ...headers,
      },
      credentials: "same-origin",
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw toNetworkError(request, error);
  }

  if (!response.ok) {
    const payload = await readApiPayload(response, request);
    throw toApiError(response, payload, request);
  }

  return response.text();
}

export function hasRefreshCookieHint(): boolean {
  return Boolean(readCsrfToken());
}

export async function refreshStoredSession(): Promise<AuthResponseBody | null> {
  if (refreshSessionPromise) {
    return refreshSessionPromise;
  }

  refreshSessionPromise = (async () => {
    const session = readStoredSession();
    const deviceId = getDeviceId();
    const devicePlatform = getDevicePlatform();
    const csrfToken = readCsrfToken();
    const request: ApiRequestContext = {
      method: "POST",
      mode: "public",
      path: "/auth/refresh",
      requestUrl: toRequestUrl("/auth/refresh"),
    };
    let response: Response;

    try {
      response = await fetch(request.requestUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
          ...(deviceId ? { "x-device-id": deviceId } : {}),
          ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          ...(session?.refreshToken
            ? { refreshToken: session.refreshToken }
            : {}),
        }),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      throw toNetworkError(request, error);
    }

    if (!response.ok) {
      clearStoredSession();
      return null;
    }

    const payload = await readApiPayload(response, request);
    const nextSession = unwrapApiResponse<AuthResponseBody>(payload, request);
    writeStoredSession(nextSession);
    return nextSession;
  })();

  try {
    return await refreshSessionPromise;
  } finally {
    refreshSessionPromise = null;
  }
}
