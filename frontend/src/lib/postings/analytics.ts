"use client";

import {
  authenticatedJson,
  buildPathWithQuery,
} from "@/lib/api/client";
import { readStoredSession } from "@/lib/auth/storage";
import { resolveApiBaseUrl } from "@/lib/env";

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

export const postingsAnalyticsApi = {
  getOwnerSummary(
    window: PostingAnalyticsWindow,
  ): Promise<OwnerPostingsAnalyticsSummary> {
    return authenticatedJson<OwnerPostingsAnalyticsSummary>(
      "GET",
      buildPathWithQuery("/postings/analytics/summary", { window }),
    );
  },

  listOwnerPostings(input: {
    window: PostingAnalyticsWindow;
    page?: number;
    pageSize?: number;
  }): Promise<PostingAnalyticsListResult> {
    return authenticatedJson<PostingAnalyticsListResult>(
      "GET",
      buildPathWithQuery("/postings/analytics/postings", {
        window: input.window,
        page: input.page ?? 1,
        pageSize: input.pageSize ?? 20,
      }),
    );
  },

  getPostingDetail(
    postingId: string,
    input: {
      window: PostingAnalyticsWindow;
      granularity: PostingAnalyticsGranularity;
    },
  ): Promise<PostingAnalyticsDetail> {
    return authenticatedJson<PostingAnalyticsDetail>(
      "GET",
      buildPathWithQuery(
        `/postings/${encodeURIComponent(postingId)}/analytics`,
        {
          window: input.window,
          granularity: input.granularity,
        },
      ),
    );
  },

  async exportCsv(window: PostingAnalyticsWindow): Promise<void> {
    const session = readStoredSession();
    const url = `${resolveApiBaseUrl()}${buildPathWithQuery("/postings/analytics/export", { window })}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "text/csv",
        ...(session?.accessToken
          ? { authorization: `Bearer ${session.accessToken}` }
          : {}),
      },
      credentials: "same-origin",
    });

    if (!response.ok) {
      throw new Error("Failed to export analytics.");
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `analytics-${window}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objectUrl);
  },
};
