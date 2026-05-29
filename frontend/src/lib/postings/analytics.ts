"use client";

import { readJson, toApiError, unwrapApiResponse } from "@/lib/api/response";
import { getDeviceId, getDevicePlatform } from "@/lib/auth/device";
import { readStoredSession } from "@/lib/auth/storage";
import { resolveApiBaseUrl } from "@/lib/env";

const apiBaseUrl = resolveApiBaseUrl();

export type PostingAnalyticsWindow = "7d" | "30d" | "all";
export type PostingAnalyticsGranularity = "hour" | "day";

export interface PostingAnalyticsMetrics {
  searchImpressions: number;
  searchClicks: number;
  views: number;
  uniqueViews: number;
  bookingRequests: number;
  approvedRequests: number;
  declinedRequests: number;
  expiredRequests: number;
  cancelledRequests: number;
  paymentFailedRequests: number;
  confirmedBookings: number;
  estimatedConfirmedRevenue: number;
  refundedRevenue: number;
  activeDaysPublished: number;
  calendarBlockedDays: number;
  confirmedBookedDays: number;
}

export type PostingAnalyticsBucketMetrics = Omit<
  PostingAnalyticsMetrics,
  "activeDaysPublished" | "calendarBlockedDays" | "confirmedBookedDays"
>;

export interface PostingAnalyticsDerivedMetrics {
  ctr: number;
  viewToRequestRate: number;
  clickToRequestRate: number;
  requestToApprovalRate: number;
  requestToConfirmedRate: number;
  utilizationRate: number;
  averageRevenuePerConfirmedBooking: number;
}

export interface PostingAnalyticsRange {
  startAt?: string;
  endAt: string;
}

export interface PostingAnalyticsDataAvailability {
  searchImpressions: "live";
  searchClicks: "live";
  views: "live";
  bookingRequests: "live";
  requestOutcomes: "live";
  confirmedBookings: "live";
  revenue: "live";
  isPartial: false;
}

export interface OwnerPostingsAnalyticsSummary {
  window: PostingAnalyticsWindow;
  totals: PostingAnalyticsMetrics;
  derivedMetrics: PostingAnalyticsDerivedMetrics;
  dataAvailability: PostingAnalyticsDataAvailability;
  range: PostingAnalyticsRange;
}

export interface PostingAnalyticsListItem {
  postingId: string;
  name: string;
  status: string;
  primaryPhotoUrl?: string;
  totals: PostingAnalyticsMetrics;
  derivedMetrics: PostingAnalyticsDerivedMetrics;
}

export interface PostingAnalyticsListResult {
  window: PostingAnalyticsWindow;
  postings: PostingAnalyticsListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  dataAvailability: PostingAnalyticsDataAvailability;
  range: PostingAnalyticsRange;
}

export interface PostingAnalyticsBucket {
  bucketStart: string;
  bucketEnd: string;
  granularity: PostingAnalyticsGranularity;
  metrics: PostingAnalyticsBucketMetrics;
  derivedMetrics: PostingAnalyticsDerivedMetrics;
}

export interface PostingAnalyticsDetail {
  postingId: string;
  name: string;
  status: string;
  primaryPhotoUrl?: string;
  window: PostingAnalyticsWindow;
  granularity: PostingAnalyticsGranularity;
  totals: PostingAnalyticsMetrics;
  derivedMetrics: PostingAnalyticsDerivedMetrics;
  buckets: PostingAnalyticsBucket[];
  dataAvailability: PostingAnalyticsDataAvailability;
  range: PostingAnalyticsRange;
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

async function authenticatedGet<TResponse>(path: string): Promise<TResponse> {
  const deviceId = getDeviceId();
  const devicePlatform = getDevicePlatform();
  const session = readStoredSession();
  const csrfToken = readCsrfToken();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...(session?.accessToken
        ? { authorization: `Bearer ${session.accessToken}` }
        : {}),
      ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
      ...(deviceId ? { "x-device-id": deviceId } : {}),
      ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
    },
    credentials: "include",
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw toApiError(response, payload);
  }

  return unwrapApiResponse<TResponse>(payload);
}

function buildQuery(
  params: Record<string, string | number | undefined>,
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  return searchParams.toString();
}

export const postingsAnalyticsApi = {
  getOwnerSummary(
    window: PostingAnalyticsWindow,
  ): Promise<OwnerPostingsAnalyticsSummary> {
    return authenticatedGet<OwnerPostingsAnalyticsSummary>(
      `/postings/analytics/summary?${buildQuery({ window })}`,
    );
  },

  listOwnerPostings(input: {
    window: PostingAnalyticsWindow;
    page?: number;
    pageSize?: number;
  }): Promise<PostingAnalyticsListResult> {
    return authenticatedGet<PostingAnalyticsListResult>(
      `/postings/analytics/postings?${buildQuery({
        window: input.window,
        page: input.page ?? 1,
        pageSize: input.pageSize ?? 20,
      })}`,
    );
  },

  getPostingDetail(
    postingId: string,
    input: {
      window: PostingAnalyticsWindow;
      granularity: PostingAnalyticsGranularity;
    },
  ): Promise<PostingAnalyticsDetail> {
    return authenticatedGet<PostingAnalyticsDetail>(
      `/postings/${encodeURIComponent(postingId)}/analytics?${buildQuery({
        window: input.window,
        granularity: input.granularity,
      })}`,
    );
  },
};
