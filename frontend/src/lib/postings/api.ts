import { readJson, toApiError, unwrapApiResponse } from "@/lib/api/response";
import { getDeviceId, getDevicePlatform } from "@/lib/auth/device";
import { readStoredSession } from "@/lib/auth/storage";
import { publicEnv } from "@/lib/env";

export interface BookingQuoteInput {
  startAt: string;
  endAt: string;
  guestCount?: number;
  note?: string | null;
}

export interface BookingQuoteFailureReason {
  code:
    | "own_posting"
    | "posting_unavailable"
    | "invalid_dates"
    | "max_duration_exceeded"
    | "invalid_guest_count"
    | "guest_count_exceeded"
    | "note_too_long"
    | "renting_overlap"
    | "availability_block_overlap"
    | "active_request_limit_exceeded";
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface BookingQuoteResult {
  postingId: string;
  bookable: boolean;
  durationDays: number | null;
  pricingCurrency: string;
  dailyPriceAmount: number;
  estimatedTotal: number | null;
  maxBookingDurationDays: number;
  failureReasons: BookingQuoteFailureReason[];
}

export interface PostingAvailabilityBlock {
  id: string;
  startAt: string;
  endAt: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilityBlockInput {
  startAt: string;
  endAt: string;
  note?: string | null;
}

export type PostingStatus = "draft" | "published" | "paused" | "archived";

export interface PostingLifecycleRecord {
  id: string;
  status: PostingStatus;
  publishedAt?: string;
  pausedAt?: string;
  archivedAt?: string;
  updatedAt: string;
}

export interface PostingViewerReviewState {
  eligible: boolean;
  hasOwnReview: boolean;
}

export interface PostingDetailResponse {
  viewerReviewState?: PostingViewerReviewState;
}

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";

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

async function authenticatedJson<
  TResponse,
  TBody extends object | undefined = undefined,
>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: TBody,
): Promise<TResponse> {
  const deviceId = getDeviceId();
  const devicePlatform = getDevicePlatform();
  const session = readStoredSession();
  const csrfToken = readCsrfToken();
  const response = await fetch(`${publicEnv.apiBaseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(session?.accessToken
        ? { authorization: `Bearer ${session.accessToken}` }
        : {}),
      ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
      ...(deviceId ? { "x-device-id": deviceId } : {}),
      ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
    },
    credentials: "include",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw toApiError(response, payload);
  }

  return unwrapApiResponse<TResponse>(payload);
}

export const postingsApi = {
  getPosting<TResponse extends PostingDetailResponse = PostingDetailResponse>(
    postingId: string,
  ): Promise<TResponse> {
    return authenticatedJson<TResponse>(
      "GET",
      `/postings/${encodeURIComponent(postingId)}`,
    );
  },

  pausePosting(postingId: string): Promise<PostingLifecycleRecord> {
    return authenticatedJson<PostingLifecycleRecord>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/pause`,
    );
  },

  duplicatePosting<TResponse>(postingId: string): Promise<TResponse> {
    return authenticatedJson<TResponse>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/duplicate`,
    );
  },

  unpausePosting(postingId: string): Promise<PostingLifecycleRecord> {
    return authenticatedJson<PostingLifecycleRecord>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/unpause`,
    );
  },

  quoteBooking(
    postingId: string,
    input: BookingQuoteInput,
  ): Promise<BookingQuoteResult> {
    return authenticatedJson<BookingQuoteResult, BookingQuoteInput>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/booking-quote`,
      input,
    );
  },

  listAvailabilityBlocks(
    postingId: string,
  ): Promise<{ availabilityBlocks: PostingAvailabilityBlock[] }> {
    return authenticatedJson<{
      availabilityBlocks: PostingAvailabilityBlock[];
    }>("GET", `/postings/${encodeURIComponent(postingId)}/availability-blocks`);
  },

  createAvailabilityBlock(
    postingId: string,
    input: AvailabilityBlockInput,
  ): Promise<PostingAvailabilityBlock> {
    return authenticatedJson<PostingAvailabilityBlock, AvailabilityBlockInput>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/availability-blocks`,
      input,
    );
  },

  updateAvailabilityBlock(
    postingId: string,
    blockId: string,
    input: AvailabilityBlockInput,
  ): Promise<PostingAvailabilityBlock> {
    return authenticatedJson<PostingAvailabilityBlock, AvailabilityBlockInput>(
      "PUT",
      `/postings/${encodeURIComponent(postingId)}/availability-blocks/${encodeURIComponent(blockId)}`,
      input,
    );
  },

  async deleteAvailabilityBlock(
    postingId: string,
    blockId: string,
  ): Promise<void> {
    await authenticatedJson<null>(
      "DELETE",
      `/postings/${encodeURIComponent(postingId)}/availability-blocks/${encodeURIComponent(blockId)}`,
    );
  },
};
