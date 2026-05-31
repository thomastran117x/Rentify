import { resolveApiBaseUrl } from "@/lib/env";
import { getDeviceId, getDevicePlatform } from "@/lib/auth/device";
import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
} from "@/lib/auth/storage";
import type { AuthResponseBody } from "@/lib/auth/types";
import {
  ApiError,
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
  return method !== "GET" && method !== "DELETE" && body !== undefined;
}

function toRequestUrl(path: string): string {
  return `${resolveApiBaseUrl()}${path}`;
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
    ...(options.mode !== "public" && csrfToken
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

export function unwrapApiResponse<TData>(payload: unknown): TData {
  const response = payload as ApiResponse<TData> | null;

  if (
    !response ||
    typeof response !== "object" ||
    response.success !== true ||
    !("data" in response)
  ) {
    throw new Error("API response payload did not include a data envelope.");
  }

  return response.data;
}

export function toApiError(response: Response, payload: unknown): ApiError {
  const errorPayload = (payload ?? null) as Partial<ApiErrorResponse> | null;
  const message = errorPayload?.message ?? "Something went wrong.";
  const code = errorPayload?.error?.code ?? "UNKNOWN_ERROR";

  return new ApiError(
    message,
    code,
    response.status,
    errorPayload?.error?.details,
  );
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
  const response = await fetch(toRequestUrl(options.path), {
    method: options.method,
    headers: buildRequestHeaders(options, options.includeAuthorization),
    credentials: "include",
    signal: options.signal,
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });

  const payload = await readJson(response);

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

  if (!response.ok) {
    throw toApiError(response, payload);
  }

  return unwrapApiResponse<TResponse>(payload);
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
  const response = await fetch(toRequestUrl(path), {
    method: "GET",
    headers: {
      accept: "application/yaml, text/yaml, text/plain",
      ...headers,
    },
    credentials: "same-origin",
  });

  if (!response.ok) {
    const payload = await readJson(response);
    throw toApiError(response, payload);
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
    const response = await fetch(toRequestUrl("/auth/refresh"), {
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

    const payload = await readJson(response);

    if (!response.ok) {
      clearStoredSession();
      return null;
    }

    const nextSession = unwrapApiResponse<AuthResponseBody>(payload);
    writeStoredSession(nextSession);
    return nextSession;
  })();

  try {
    return await refreshSessionPromise;
  } finally {
    refreshSessionPromise = null;
  }
}
