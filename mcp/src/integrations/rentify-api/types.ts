export interface RentifyPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface RentifyPostingSummary extends Record<string, unknown> {
  id: string;
  name: string;
}

export interface RentifyPostingRecord extends Record<string, unknown> {
  id: string;
  ownerId?: string;
  name?: string;
  status?: string;
}

export interface SearchPostingsResponse extends Record<string, unknown> {
  postings: RentifyPostingSummary[];
  pagination: RentifyPagination;
  source: string;
  query?: string;
}

export interface GetPostingResponse extends Record<string, unknown> {
  id: string;
  name?: string;
  status?: string;
}

export interface ListOwnerPostingsResponse extends Record<string, unknown> {
  postings: RentifyPostingRecord[];
  pagination: RentifyPagination;
  status?: string;
}

export interface BatchGetPostingsResponse extends Record<string, unknown> {
  postings: RentifyPostingSummary[];
  missingIds: string[];
}

export interface PostingAvailabilityBlockResponse extends Record<string, unknown> {
  id: string;
  startAt?: string;
  endAt?: string;
}

export interface ListPostingAvailabilityBlocksResponse extends Record<string, unknown> {
  availabilityBlocks: PostingAvailabilityBlockResponse[];
}

export interface PostingReviewRecord extends Record<string, unknown> {
  id: string;
  rating: number;
}

export interface ListPostingReviewsResponse extends Record<string, unknown> {
  reviews: PostingReviewRecord[];
  summary: {
    averageRating: number;
    reviewCount: number;
  };
  pagination: RentifyPagination;
}

export interface PostingAnalyticsSummaryResponse extends Record<string, unknown> {
  window: string;
  totals: Record<string, unknown>;
}

export interface PostingAnalyticsListResponse extends Record<string, unknown> {
  window: string;
  postings: Array<Record<string, unknown>>;
  pagination: RentifyPagination;
}

export interface PostingAnalyticsDetailResponse extends Record<string, unknown> {
  postingId: string;
  name?: string;
  window: string;
  granularity: string;
  buckets: Array<Record<string, unknown>>;
  totals: Record<string, unknown>;
}

export interface RentifyBookingPostingSummary extends Record<string, unknown> {
  id: string;
  name: string;
  primaryPhotoUrl?: string;
  effectiveMaxBookingDurationDays?: number;
}

export interface BookingRequestRecord extends Record<string, unknown> {
  id: string;
  postingId: string;
  renterId?: string;
  ownerId?: string;
  status: string;
  startAt: string;
  endAt: string;
  durationDays?: number;
  guestCount: number;
  contactName?: string;
  contactEmail?: string;
  contactPhoneNumber?: string;
  note?: string;
  pricingCurrency?: string;
  dailyPriceAmount?: number;
  estimatedTotal?: number;
  cancelledAt?: string;
  cancelledByUserId?: string;
  cancellationActor?: "renter" | "owner";
  cancellationReason?: string;
  cancellationPolicyCode?: string;
  cancellationRefundAmount?: number;
  refundedAt?: string;
  rentingId?: string;
  posting: RentifyBookingPostingSummary;
}

export interface BookingRequestsListResponse extends Record<string, unknown> {
  bookingRequests: BookingRequestRecord[];
  pagination: RentifyPagination;
  status?: string;
}

export interface BookingQuoteFailureReason extends Record<string, unknown> {
  code: string;
  message: string;
  field?: string;
}

export interface BookingQuoteResponse extends Record<string, unknown> {
  postingId: string;
  bookable: boolean;
  durationDays: number | null;
  pricingCurrency: string;
  dailyPriceAmount: number;
  estimatedTotal: number | null;
  maxBookingDurationDays: number;
  failureReasons: BookingQuoteFailureReason[];
}

export interface BookingCancellationFailureReason extends Record<string, unknown> {
  code: string;
  message: string;
}

export interface BookingCancellationQuoteResponse extends Record<string, unknown> {
  bookingRequestId: string;
  cancellable: boolean;
  actor: "renter" | "owner";
  bookingStatus: string;
  reasonRequired: boolean;
  policyCode: string;
  refundType: "full" | "partial" | "none" | "unsupported";
  refundAmount: number;
  currency: string;
  failureReasons: BookingCancellationFailureReason[];
}

export interface RentifyRentingPostingSummary extends Record<string, unknown> {
  id: string;
  name: string;
  primaryPhotoUrl?: string;
}

export interface RentingRecord extends Record<string, unknown> {
  id: string;
  postingId: string;
  bookingRequestId: string;
  renterId?: string;
  ownerId?: string;
  status: string;
  startAt: string;
  endAt: string;
  durationDays?: number;
  guestCount?: number;
  pricingCurrency?: string;
  dailyPriceAmount?: number;
  estimatedTotal?: number;
  confirmedAt?: string;
  pickupInstructions?: string;
  returnInstructions?: string;
  checkInReadyAt?: string;
  checkInCompletedAt?: string;
  returnDueAt?: string;
  completedAt?: string;
  disputedAt?: string;
  cancelledAt?: string;
  dispute?: {
    id: string;
    rentingId: string;
    openedByUserId: string;
    reason: string;
    details?: string;
    createdAt: string;
    updatedAt: string;
  };
  posting: RentifyRentingPostingSummary;
}

export interface RentingsListResponse extends Record<string, unknown> {
  rentings: RentingRecord[];
  pagination: RentifyPagination;
  status?: string;
}
