export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ApiResponseMeta {
  requestId: string;
  pagination?: Pagination | Record<string, unknown>;
  [key: string]: unknown;
}

export interface ApiErrorPayload<TDetails = unknown> {
  code: string;
  details?: TDetails;
}

export interface ApiRequestContext {
  method: string;
  path: string;
  requestUrl: string;
  mode?: "public" | "authenticated" | "optionalAuth";
}

export interface ApiResponse<TData> {
  success: true;
  message: string;
  data: TData;
  error: null;
  meta: ApiResponseMeta;
}

export interface ApiErrorResponse<TDetails = unknown> {
  success: false;
  message: string;
  data: null;
  error: ApiErrorPayload<TDetails>;
  meta: ApiResponseMeta;
}

interface ApiErrorOptions {
  code: string;
  request: ApiRequestContext;
  status?: number;
  details?: unknown;
  cause?: unknown;
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly status?: number;
  public readonly details?: unknown;
  public readonly request: ApiRequestContext;
  public override readonly cause?: unknown;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    this.request = options.request;
    this.cause = options.cause;
  }
}

export class ApiClientError extends ApiError {
  declare public readonly status: number;

  constructor(
    message: string,
    options: Omit<ApiErrorOptions, "status"> & { status: number },
  ) {
    super(message, options);
    this.name = "ApiClientError";
  }
}

export class ApiRateLimitError extends ApiClientError {
  declare public readonly status: 429;

  constructor(
    message: string,
    options: Omit<ApiErrorOptions, "status"> & { status: 429 },
  ) {
    super(message, options);
    this.name = "ApiRateLimitError";
  }
}

export class ApiServerError extends ApiError {
  declare public readonly status: number;

  constructor(
    message: string,
    options: Omit<ApiErrorOptions, "status"> & { status: number },
  ) {
    super(message, options);
    this.name = "ApiServerError";
  }
}

export class ApiNetworkError extends ApiError {
  constructor(message: string, options: Omit<ApiErrorOptions, "status">) {
    super(message, options);
    this.name = "ApiNetworkError";
  }
}

export class ApiProtocolError extends ApiError {
  constructor(message: string, options: ApiErrorOptions) {
    super(message, options);
    this.name = "ApiProtocolError";
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function isApiRateLimitError(error: unknown): error is ApiRateLimitError {
  return error instanceof ApiRateLimitError;
}

export function isApiServerError(error: unknown): error is ApiServerError {
  return error instanceof ApiServerError;
}

export function isApiNetworkError(error: unknown): error is ApiNetworkError {
  return error instanceof ApiNetworkError;
}

export function isApiProtocolError(error: unknown): error is ApiProtocolError {
  return error instanceof ApiProtocolError;
}

export interface ActionOkResult {
  ok?: true;
  loggedOut?: true;
}
