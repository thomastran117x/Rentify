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

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ActionOkResult {
  ok?: true;
  loggedOut?: true;
}
