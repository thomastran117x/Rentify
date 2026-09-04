import { z } from "zod";
import { MAX_PAGE_SIZE } from "@/features/postings/postings.model";
import type { Uuid } from "@/configuration/validation/uuid";

export const postingAnalyticsWindowSchema = z.enum(["7d", "30d", "all"]);
export const postingAnalyticsGranularitySchema = z.enum(["hour", "day"]);

export const postingAnalyticsSummaryQuerySchema = z.object({
  window: postingAnalyticsWindowSchema.default("7d"),
});

export const listPostingAnalyticsQuerySchema = z.object({
  window: postingAnalyticsWindowSchema.default("7d"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export const postingAnalyticsDetailQuerySchema = z.object({
  window: postingAnalyticsWindowSchema.default("7d"),
  granularity: postingAnalyticsGranularitySchema.default("day"),
});

export type PostingAnalyticsWindow = z.infer<
  typeof postingAnalyticsWindowSchema
>;
export type PostingAnalyticsGranularity = z.infer<
  typeof postingAnalyticsGranularitySchema
>;
export type PostingAnalyticsSummaryQuery = z.infer<
  typeof postingAnalyticsSummaryQuerySchema
>;
export type ListPostingAnalyticsQuery = z.infer<
  typeof listPostingAnalyticsQuerySchema
>;
export type PostingAnalyticsDetailQuery = z.infer<
  typeof postingAnalyticsDetailQuerySchema
>;

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

export interface PostingAnalyticsBucketMetrics {
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
}

export interface PostingAnalyticsDerivedMetrics {
  ctr: number;
  viewToRequestRate: number;
  clickToRequestRate: number;
  requestToApprovalRate: number;
  requestToConfirmedRate: number;
  utilizationRate: number;
  averageRevenuePerConfirmedBooking: number;
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

export interface PostingAnalyticsRange {
  startAt?: string;
  endAt: string;
}

export interface OwnerPostingsAnalyticsSummary {
  window: PostingAnalyticsWindow;
  totals: PostingAnalyticsMetrics;
  derivedMetrics: PostingAnalyticsDerivedMetrics;
  dataAvailability: PostingAnalyticsDataAvailability;
  range: PostingAnalyticsRange;
}

export interface PostingAnalyticsListItem {
  postingId: Uuid;
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
  postingId: Uuid;
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

interface BasePostingAnalyticsEventInput {
  postingId: Uuid;
  organizationId: Uuid;
  occurredAt: string;
}

export interface EnqueuePostingViewedEventInput
  extends BasePostingAnalyticsEventInput {
  viewerHash: string;
  userId?: Uuid;
  ipAddressHash?: string;
  userAgentHash?: string;
  deviceType: string;
}

export interface EnqueueSearchImpressionEventInput
  extends BasePostingAnalyticsEventInput {}

export interface EnqueueSearchClickEventInput
  extends BasePostingAnalyticsEventInput {}

export interface EnqueueBookingRequestedEventInput
  extends BasePostingAnalyticsEventInput {
  estimatedTotal: number;
}

export interface EnqueueBookingApprovedEventInput
  extends BasePostingAnalyticsEventInput {}

export interface EnqueueBookingDeclinedEventInput
  extends BasePostingAnalyticsEventInput {}

export interface EnqueueBookingExpiredEventInput
  extends BasePostingAnalyticsEventInput {}

export interface EnqueueBookingCancelledEventInput
  extends BasePostingAnalyticsEventInput {}

export interface EnqueuePaymentFailedEventInput
  extends BasePostingAnalyticsEventInput {}

export interface EnqueueRefundRecordedEventInput
  extends BasePostingAnalyticsEventInput {
  refundedAmount: number;
}

export interface EnqueueRentingConfirmedEventInput
  extends BasePostingAnalyticsEventInput {
  estimatedTotal: number;
}

export interface ProcessPostingViewedEventInput
  extends EnqueuePostingViewedEventInput {
  eventDate: string;
  eventHour: string;
}

export interface ProcessSearchImpressionEventInput
  extends EnqueueSearchImpressionEventInput {
  eventDate: string;
  eventHour: string;
}

export interface ProcessSearchClickEventInput
  extends EnqueueSearchClickEventInput {
  eventDate: string;
  eventHour: string;
}

export interface ProcessBookingRequestedEventInput
  extends EnqueueBookingRequestedEventInput {
  eventDate: string;
  eventHour: string;
}

export interface ProcessBookingApprovedEventInput
  extends EnqueueBookingApprovedEventInput {
  eventDate: string;
  eventHour: string;
}

export interface ProcessBookingDeclinedEventInput
  extends EnqueueBookingDeclinedEventInput {
  eventDate: string;
  eventHour: string;
}

export interface ProcessBookingExpiredEventInput
  extends EnqueueBookingExpiredEventInput {
  eventDate: string;
  eventHour: string;
}

export interface ProcessBookingCancelledEventInput
  extends EnqueueBookingCancelledEventInput {
  eventDate: string;
  eventHour: string;
}

export interface ProcessPaymentFailedEventInput
  extends EnqueuePaymentFailedEventInput {
  eventDate: string;
  eventHour: string;
}

export interface ProcessRefundRecordedEventInput
  extends EnqueueRefundRecordedEventInput {
  eventDate: string;
  eventHour: string;
}

export interface ProcessRentingConfirmedEventInput
  extends EnqueueRentingConfirmedEventInput {
  eventDate: string;
  eventHour: string;
}

export type PostingAnalyticsEventType =
  | "posting_viewed"
  | "search_impression"
  | "search_click"
  | "booking_requested"
  | "booking_approved"
  | "booking_declined"
  | "booking_expired"
  | "booking_cancelled"
  | "payment_failed"
  | "refund_recorded"
  | "renting_confirmed";

export interface PostingAnalyticsOutboxRecord {
  id: Uuid;
  postingId: Uuid;
  organizationId: Uuid;
  eventType: PostingAnalyticsEventType;
  payload: Record<string, unknown>;
  attempts: number;
  availableAt: string;
  processingAt?: string;
  processedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// The owning organization is resolved from the actor's active membership in
// PostingAnalyticsService, so callers neither know nor supply it.
export interface PostingAnalyticsSummaryInput {
  actorUserId: Uuid;
  window: PostingAnalyticsWindow;
}

/** PostingAnalyticsSummaryInput once the service has resolved the owning organization. */
export interface PostingAnalyticsSummaryPersistenceInput
  extends PostingAnalyticsSummaryInput {
  organizationId: Uuid;
}

export interface ListPostingAnalyticsInput
  extends PostingAnalyticsSummaryInput {
  page: number;
  pageSize: number;
}

/** ListPostingAnalyticsInput once the service has resolved the owning organization. */
export interface ListPostingAnalyticsPersistenceInput
  extends ListPostingAnalyticsInput {
  organizationId: Uuid;
}

export interface PostingAnalyticsDetailInput
  extends PostingAnalyticsSummaryInput {
  postingId: Uuid;
  granularity: PostingAnalyticsGranularity;
}

/** PostingAnalyticsDetailInput once the service has resolved the owning organization. */
export interface PostingAnalyticsDetailPersistenceInput
  extends PostingAnalyticsDetailInput {
  organizationId: Uuid;
}
