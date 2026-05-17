import type {
  BatchGetPostingsResponse,
  BookingQuoteResponse,
  BookingRequestRecord,
  BookingRequestsListResponse,
  GetPostingResponse,
  ListOwnerPostingsResponse,
  ListPostingAvailabilityBlocksResponse,
  ListPostingReviewsResponse,
  PostingAnalyticsDetailResponse,
  PostingAnalyticsListResponse,
  PostingAnalyticsSummaryResponse,
  PostingAvailabilityBlockResponse,
  RentingRecord,
  RentingsListResponse,
  RentifyPostingRecord,
  SearchPostingsResponse,
} from "./types.js";

type QueryScalar = string | number | boolean;
type QueryValue = QueryScalar | QueryScalar[] | null | undefined;
type QueryParams = Record<string, QueryValue>;
type JsonObject = Record<string, unknown>;

interface RequestOptions {
  requiresAuth?: boolean;
}

interface ErrorPayload {
  error?: string;
  code?: string;
  details?: unknown;
}

export interface RentifyApiClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  personalAccessToken?: string;
}

export interface SearchPostingsQuery extends QueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  family?: string;
  subtype?: string;
  tags?: string[];
  availabilityStatus?: "available" | "limited" | "unavailable";
  minDailyPrice?: number;
  maxDailyPrice?: number;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  startAt?: string;
  endAt?: string;
  sort?: "relevance" | "newest" | "oldest" | "dailyPrice" | "nearest" | "nameAsc" | "nameDesc";
}

export interface ListMyPostingsQuery extends QueryParams {
  page?: number;
  pageSize?: number;
  status?: "draft" | "published" | "paused" | "archived";
}

export interface PostingAnalyticsListQuery extends QueryParams {
  window?: "7d" | "30d" | "all";
  page?: number;
  pageSize?: number;
}

export interface PostingAnalyticsDetailQuery extends QueryParams {
  window?: "7d" | "30d" | "all";
  granularity?: "hour" | "day";
}

export interface PostingWriteBody extends JsonObject {
  variant: {
    family: "place" | "equipment" | "vehicle";
    subtype: string;
  };
  name: string;
  description: string;
  pricing: {
    currency: string;
    daily: {
      amount: number;
    };
    hourly?: {
      amount: number;
    };
    weekly?: {
      amount: number;
    };
    monthly?: {
      amount: number;
    };
  };
  photos: Array<{
    blobUrl: string;
    blobName: string;
    position: number;
  }>;
  tags: string[];
  details: Record<string, string | number | boolean | string[]>;
  availabilityStatus: "available" | "limited" | "unavailable";
  availabilityNotes?: string | null;
  maxBookingDurationDays?: number | null;
  location: {
    latitude: number;
    longitude: number;
    city: string;
    region: string;
    country: string;
    postalCode?: string | null;
  };
}

export interface CreatePostingBody extends PostingWriteBody {
  availabilityBlocks: Array<{
    startAt: string;
    endAt: string;
    note?: string | null;
  }>;
}

export interface UpdatePostingBody extends PostingWriteBody {}

export interface PostingAvailabilityBlockBody extends JsonObject {
  startAt: string;
  endAt: string;
  note?: string | null;
}

export interface PostingReviewBody extends JsonObject {
  rating: number;
  title?: string | null;
  comment?: string | null;
}

export interface BookingRequestBody extends JsonObject {
  startAt: string;
  endAt: string;
  guestCount?: number;
  note?: string | null;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber?: string | null;
}

export interface BookingQuoteBody extends JsonObject {
  startAt: string;
  endAt: string;
  guestCount?: number;
  note?: string | null;
}

export interface BookingRequestDecisionBody extends JsonObject {
  note?: string | null;
}

export interface ListBookingRequestsQuery extends QueryParams {
  page?: number;
  pageSize?: number;
  status?:
    | "pending"
    | "approved"
    | "awaiting_payment"
    | "payment_processing"
    | "paid"
    | "payment_failed"
    | "declined"
    | "expired"
    | "cancelled"
    | "refunded";
}

export interface ListMyRentingsQuery extends QueryParams {
  page?: number;
  pageSize?: number;
  status?: "confirmed";
}

export class BackendApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: unknown,
    message: string,
  ) {
    super(message);
    this.name = "BackendApiError";
  }
}

export class BackendUnavailableError extends Error {
  constructor(
    readonly code: "BACKEND_TIMEOUT" | "BACKEND_UNAVAILABLE",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

export class AuthNotConfiguredError extends Error {
  readonly code = "AUTH_NOT_CONFIGURED";

  constructor(message = "Protected Rentify MCP requests require RENTIFY_PAT.") {
    super(message);
    this.name = "AuthNotConfiguredError";
  }
}

function appendQueryValue(searchParams: URLSearchParams, key: string, value: QueryValue): void {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      searchParams.append(key, String(entry));
    }
    return;
  }

  searchParams.set(key, String(value));
}

export function buildApiUrl(baseUrl: string, path: string, query: QueryParams = {}): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(normalizedPath, normalizedBaseUrl);
  url.searchParams.set("format", "json");

  for (const [key, value] of Object.entries(query)) {
    appendQueryValue(url.searchParams, key, value);
  }

  return url;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class RentifyApiClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly personalAccessToken?: string;

  constructor(private readonly options: RentifyApiClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.personalAccessToken = options.personalAccessToken;
  }

  async searchPostings(query: SearchPostingsQuery): Promise<SearchPostingsResponse> {
    return this.get<SearchPostingsResponse>("/postings", query);
  }

  async getPosting(id: string): Promise<GetPostingResponse> {
    return this.get<GetPostingResponse>(`/postings/${encodeURIComponent(id)}`);
  }

  async batchGetPostings(ids: string[]): Promise<BatchGetPostingsResponse> {
    return this.get<BatchGetPostingsResponse>("/postings/batch", {
      ids,
    });
  }

  async listPostingReviews(
    postingId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<ListPostingReviewsResponse> {
    return this.get<ListPostingReviewsResponse>(
      `/postings/${encodeURIComponent(postingId)}/reviews`,
      query,
    );
  }

  async getMyPosting(id: string): Promise<GetPostingResponse> {
    return this.getProtected<GetPostingResponse>(`/postings/${encodeURIComponent(id)}`);
  }

  async listMyPostings(query: ListMyPostingsQuery = {}): Promise<ListOwnerPostingsResponse> {
    return this.getProtected<ListOwnerPostingsResponse>("/postings/me", query);
  }

  async batchGetMyPostings(ids: string[]): Promise<BatchGetPostingsResponse> {
    return this.getProtected<BatchGetPostingsResponse>("/postings/me/batch", {
      ids,
    });
  }

  async createPosting(body: CreatePostingBody): Promise<RentifyPostingRecord> {
    return this.postProtected<RentifyPostingRecord>("/postings", body);
  }

  async updatePosting(id: string, body: UpdatePostingBody): Promise<RentifyPostingRecord> {
    return this.putProtected<RentifyPostingRecord>(`/postings/${encodeURIComponent(id)}`, body);
  }

  async duplicatePosting(id: string): Promise<RentifyPostingRecord> {
    return this.postProtected<RentifyPostingRecord>(
      `/postings/${encodeURIComponent(id)}/duplicate`,
      {},
    );
  }

  async publishPosting(id: string): Promise<RentifyPostingRecord> {
    return this.postProtected<RentifyPostingRecord>(
      `/postings/${encodeURIComponent(id)}/publish`,
      {},
    );
  }

  async pausePosting(id: string): Promise<RentifyPostingRecord> {
    return this.postProtected<RentifyPostingRecord>(
      `/postings/${encodeURIComponent(id)}/pause`,
      {},
    );
  }

  async unpausePosting(id: string): Promise<RentifyPostingRecord> {
    return this.postProtected<RentifyPostingRecord>(
      `/postings/${encodeURIComponent(id)}/unpause`,
      {},
    );
  }

  async archivePosting(id: string): Promise<RentifyPostingRecord> {
    return this.postProtected<RentifyPostingRecord>(
      `/postings/${encodeURIComponent(id)}/archive`,
      {},
    );
  }

  async listPostingAvailabilityBlocks(
    postingId: string,
  ): Promise<ListPostingAvailabilityBlocksResponse> {
    return this.getProtected<ListPostingAvailabilityBlocksResponse>(
      `/postings/${encodeURIComponent(postingId)}/availability-blocks`,
    );
  }

  async createPostingAvailabilityBlock(
    postingId: string,
    body: PostingAvailabilityBlockBody,
  ): Promise<PostingAvailabilityBlockResponse> {
    return this.postProtected<PostingAvailabilityBlockResponse>(
      `/postings/${encodeURIComponent(postingId)}/availability-blocks`,
      body,
    );
  }

  async updatePostingAvailabilityBlock(
    postingId: string,
    blockId: string,
    body: PostingAvailabilityBlockBody,
  ): Promise<PostingAvailabilityBlockResponse> {
    return this.putProtected<PostingAvailabilityBlockResponse>(
      `/postings/${encodeURIComponent(postingId)}/availability-blocks/${encodeURIComponent(blockId)}`,
      body,
    );
  }

  async deletePostingAvailabilityBlock(postingId: string, blockId: string): Promise<void> {
    await this.deleteProtected<void>(
      `/postings/${encodeURIComponent(postingId)}/availability-blocks/${encodeURIComponent(blockId)}`,
    );
  }

  async getPostingsAnalyticsSummary(
    window?: "7d" | "30d" | "all",
  ): Promise<PostingAnalyticsSummaryResponse> {
    return this.getProtected<PostingAnalyticsSummaryResponse>("/postings/analytics/summary", {
      window,
    });
  }

  async listPostingsAnalytics(
    query: PostingAnalyticsListQuery = {},
  ): Promise<PostingAnalyticsListResponse> {
    return this.getProtected<PostingAnalyticsListResponse>("/postings/analytics/postings", query);
  }

  async getPostingAnalytics(
    postingId: string,
    query: PostingAnalyticsDetailQuery = {},
  ): Promise<PostingAnalyticsDetailResponse> {
    return this.getProtected<PostingAnalyticsDetailResponse>(
      `/postings/${encodeURIComponent(postingId)}/analytics`,
      query,
    );
  }

  async createPostingReview(
    postingId: string,
    body: PostingReviewBody,
  ): Promise<Record<string, unknown>> {
    return this.postProtected<Record<string, unknown>>(
      `/postings/${encodeURIComponent(postingId)}/reviews`,
      body,
    );
  }

  async updateMyPostingReview(
    postingId: string,
    body: PostingReviewBody,
  ): Promise<Record<string, unknown>> {
    return this.putProtected<Record<string, unknown>>(
      `/postings/${encodeURIComponent(postingId)}/reviews/me`,
      body,
    );
  }

  async quoteBookingForPosting(
    postingId: string,
    body: BookingQuoteBody,
  ): Promise<BookingQuoteResponse> {
    return this.postProtected<BookingQuoteResponse>(
      `/postings/${encodeURIComponent(postingId)}/booking-quote`,
      body,
    );
  }

  async createBookingRequest(
    postingId: string,
    body: BookingRequestBody,
  ): Promise<BookingRequestRecord> {
    return this.postProtected<BookingRequestRecord>(
      `/postings/${encodeURIComponent(postingId)}/booking-requests`,
      body,
    );
  }

  async listMyBookingRequests(
    query: ListBookingRequestsQuery = {},
  ): Promise<BookingRequestsListResponse> {
    return this.getProtected<BookingRequestsListResponse>("/booking-requests/me", query);
  }

  async listPostingBookingRequests(
    postingId: string,
    query: ListBookingRequestsQuery = {},
  ): Promise<BookingRequestsListResponse> {
    return this.getProtected<BookingRequestsListResponse>(
      `/postings/${encodeURIComponent(postingId)}/booking-requests`,
      query,
    );
  }

  async getBookingRequest(id: string): Promise<BookingRequestRecord> {
    return this.getProtected<BookingRequestRecord>(`/booking-requests/${encodeURIComponent(id)}`);
  }

  async updateBookingRequest(id: string, body: BookingRequestBody): Promise<BookingRequestRecord> {
    return this.putProtected<BookingRequestRecord>(
      `/booking-requests/${encodeURIComponent(id)}`,
      body,
    );
  }

  async approveBookingRequest(
    id: string,
    body: BookingRequestDecisionBody = {},
  ): Promise<BookingRequestRecord> {
    return this.postProtected<BookingRequestRecord>(
      `/booking-requests/${encodeURIComponent(id)}/approve`,
      body,
    );
  }

  async declineBookingRequest(
    id: string,
    body: BookingRequestDecisionBody = {},
  ): Promise<BookingRequestRecord> {
    return this.postProtected<BookingRequestRecord>(
      `/booking-requests/${encodeURIComponent(id)}/decline`,
      body,
    );
  }

  async listMyRentings(query: ListMyRentingsQuery = {}): Promise<RentingsListResponse> {
    return this.getProtected<RentingsListResponse>("/rentings/me", query);
  }

  async getRenting(id: string): Promise<RentingRecord> {
    return this.getProtected<RentingRecord>(`/rentings/${encodeURIComponent(id)}`);
  }

  async getProtected<TResponse>(path: string, query?: QueryParams): Promise<TResponse> {
    return this.get<TResponse>(path, query, {
      requiresAuth: true,
    });
  }

  private async get<TResponse>(
    path: string,
    query?: QueryParams,
    requestOptions: RequestOptions = {},
  ): Promise<TResponse> {
    return this.request<TResponse>({
      method: "GET",
      path,
      query,
      requestOptions,
    });
  }

  private async postProtected<TResponse>(path: string, body: JsonObject): Promise<TResponse> {
    return this.request<TResponse>({
      method: "POST",
      path,
      body,
      requestOptions: {
        requiresAuth: true,
      },
    });
  }

  private async putProtected<TResponse>(path: string, body: JsonObject): Promise<TResponse> {
    return this.request<TResponse>({
      method: "PUT",
      path,
      body,
      requestOptions: {
        requiresAuth: true,
      },
    });
  }

  private async deleteProtected<TResponse>(path: string): Promise<TResponse> {
    return this.request<TResponse>({
      method: "DELETE",
      path,
      requestOptions: {
        requiresAuth: true,
      },
    });
  }

  private async request<TResponse>({
    method,
    path,
    query,
    body: requestBody,
    requestOptions = {},
  }: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    query?: QueryParams;
    body?: JsonObject;
    requestOptions?: RequestOptions;
  }): Promise<TResponse> {
    return this.executeRequest<TResponse>({
      method,
      path,
      query,
      body: requestBody,
      requestOptions,
    });
  }

  private async executeRequest<TResponse>({
    method,
    path,
    query,
    body,
    requestOptions,
  }: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    query?: QueryParams;
    body?: JsonObject;
    requestOptions: RequestOptions;
  }): Promise<TResponse> {
    const url = buildApiUrl(this.options.baseUrl, path, query);
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.options.timeoutMs);

    try {
      const headers = this.createHeaders(requestOptions.requiresAuth ?? false, body);
      const response = await this.fetchImplementation(url, {
        method,
        headers,
        signal: abortController.signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const parsedBody = await parseResponseBody(response);

      if (!response.ok) {
        const payload = (parsedBody ?? {}) as ErrorPayload;

        throw new BackendApiError(
          response.status,
          payload.code ?? "BACKEND_ERROR",
          payload.details,
          payload.error ?? `Rentify backend returned HTTP ${response.status}.`,
        );
      }

      return parsedBody as TResponse;
    } catch (error) {
      if (error instanceof AuthNotConfiguredError) {
        throw error;
      }

      if (error instanceof BackendApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new BackendUnavailableError(
          "BACKEND_TIMEOUT",
          `Timed out after ${this.options.timeoutMs}ms while calling the Rentify backend.`,
        );
      }

      throw new BackendUnavailableError(
        "BACKEND_UNAVAILABLE",
        "Could not reach the Rentify backend API.",
        error instanceof Error ? error.message : error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private createHeaders(
    requiresAuth: boolean,
    body?: JsonObject,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
    };

    if (body) {
      headers["content-type"] = "application/json";
    }

    if (!requiresAuth) {
      return headers;
    }

    const accessToken = this.personalAccessToken;

    if (!accessToken) {
      throw new AuthNotConfiguredError();
    }

    headers.authorization = `Bearer ${accessToken}`;
    return headers;
  }
}
