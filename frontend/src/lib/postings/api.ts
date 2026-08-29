import {
  authenticatedJson,
  buildPathWithQuery,
  optionalAuthJson,
  publicJson,
} from "@/lib/api/client";
import type { Pagination } from "@/lib/api/types";
import type {
  PostingAnalyticsDetail,
  PostingAnalyticsGranularity,
  PostingAnalyticsListResult,
  PostingAnalyticsWindow,
  OwnerPostingsAnalyticsSummary,
} from "@/lib/postings/analytics";
import type {
  ListPublicPostingReviewsResult,
  PublicPostingDetail,
  PublicPostingReviewRecord,
} from "@/lib/postings/public";
import type {
  PublicPostingAutocompleteParams,
  PublicPostingAutocompleteResult,
  PublicPostingSearchParams,
  PublicPostingSearchResult,
} from "@/lib/postings/search";

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
    | "min_duration_not_met"
    | "start_date_in_past"
    | "advance_notice_not_met"
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
  minBookingDurationDays: number | null;
  advanceNoticeDays: number | null;
  instantBooking: boolean;
  cancellationPolicy: "flexible" | "moderate" | "strict" | null;
  cancellationPolicyNotes: string | null;
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
export type PostingAvailabilityStatus = "available" | "limited" | "unavailable";
export type PostingCancellationPolicy = "flexible" | "moderate" | "strict";
export type PostingFamily = "place" | "equipment" | "vehicle";
export type PostingDetailValue = string | number | boolean | string[];

export interface PostingVariant {
  family: PostingFamily;
  subtype: string;
}

export interface PostingPricing {
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
}

export interface PostingPhotoInput {
  blobUrl: string;
  blobName: string;
  position: number;
}

export interface PostingLocationInput {
  city: string;
  region: string;
  country: string;
  postalCode?: string | null;
  latitude: number;
  longitude: number;
}

export interface UpsertPostingInput {
  name: string;
  description: string;
  pricing: PostingPricing;
  photos: PostingPhotoInput[];
  tags: string[];
  availabilityStatus: PostingAvailabilityStatus;
  availabilityNotes?: string | null;
  maxBookingDurationDays?: number | null;
  minBookingDurationDays?: number | null;
  advanceNoticeDays?: number | null;
  cancellationPolicy?: PostingCancellationPolicy | null;
  cancellationPolicyNotes?: string | null;
  instantBooking?: boolean;
  expiresAt?: string | null;
  location: PostingLocationInput;
  variant: PostingVariant;
  details: Record<string, PostingDetailValue>;
  availabilityBlocks?: AvailabilityBlockInput[];
}

export interface PostingLifecycleRecord {
  id: string;
  status: PostingStatus;
  publishedAt?: string;
  pausedAt?: string;
  archivedAt?: string;
  expiresAt?: string;
  updatedAt: string;
}

export interface PostingViewerReviewState {
  eligible: boolean;
  hasOwnReview: boolean;
}

export interface PostingDetailResponse {
  viewerReviewState?: PostingViewerReviewState;
}

export interface PostingRecord
  extends Omit<PublicPostingDetail, "status" | "details" | "variant"> {
  organizationId: string;
  status: PostingStatus;
  variant: PostingVariant;
  details: Record<string, PostingDetailValue>;
}

export interface ListOwnerPostingsResult {
  postings: PostingRecord[];
  pagination: Pagination;
  status?: PostingStatus;
}

export interface OwnerPostingsStatusSummary {
  total: number;
  byStatus: {
    draft: number;
    published: number;
    paused: number;
    archived: number;
  };
}

export interface BatchPostingsResult<TRecord> {
  postings: TRecord[];
  missingIds: string[];
}

export interface CreatePostingReviewInput {
  rating: number;
  // The API rejects empty strings, so blank fields must be sent as null.
  title?: string | null;
  comment?: string | null;
}

export type UpdateOwnPostingReviewInput = CreatePostingReviewInput;

export interface PostingOwnReviewState {
  eligible: boolean;
  review: PublicPostingReviewRecord | null;
}

export interface ListRecommendationsFilters {
  page?: number;
  pageSize?: number;
  family?: PostingFamily;
  subtype?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  startAt?: string;
  endAt?: string;
}

export interface TrackPostingSearchClickInput {
  searchSessionId: string;
  query?: string;
  family?: PostingFamily;
  subtype?: string;
  page?: number;
  position?: number;
  source?: string;
}

function toIdsPath(path: string, ids: string[]): string {
  return buildPathWithQuery(path, { ids });
}

export interface SeasonalPricingRule {
  id: string;
  postingId: string;
  name: string;
  startDate: string;
  endDate: string;
  dailyAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SeasonalPricingRuleInput {
  name: string;
  startDate: string;
  endDate: string;
  dailyAmount: number;
}

export const postingsApi = {
  create(input: UpsertPostingInput): Promise<PostingRecord> {
    return authenticatedJson<PostingRecord, UpsertPostingInput>(
      "POST",
      "/postings",
      input,
    );
  },

  listMine(input?: {
    page?: number;
    pageSize?: number;
    status?: PostingStatus;
    q?: string;
  }): Promise<ListOwnerPostingsResult> {
    return authenticatedJson<ListOwnerPostingsResult>(
      "GET",
      buildPathWithQuery("/postings/me", {
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 20,
        status: input?.status,
        q: input?.q?.trim() ? input.q.trim() : undefined,
      }),
    );
  },

  getStatusSummary(): Promise<OwnerPostingsStatusSummary> {
    return authenticatedJson<OwnerPostingsStatusSummary>(
      "GET",
      "/postings/me/summary",
    );
  },

  batchMine(ids: string[]): Promise<BatchPostingsResult<PostingRecord>> {
    return authenticatedJson<BatchPostingsResult<PostingRecord>>(
      "GET",
      toIdsPath("/postings/me/batch", ids),
    );
  },

  update(postingId: string, input: UpsertPostingInput): Promise<PostingRecord> {
    return authenticatedJson<PostingRecord, UpsertPostingInput>(
      "PUT",
      `/postings/${encodeURIComponent(postingId)}`,
      input,
    );
  },

  getPosting<
    TResponse extends PostingDetailResponse &
      PublicPostingDetail = PublicPostingDetail,
  >(postingId: string): Promise<TResponse> {
    return optionalAuthJson<TResponse>(
      "GET",
      `/postings/${encodeURIComponent(postingId)}`,
    );
  },

  duplicate(postingId: string): Promise<PostingRecord> {
    return authenticatedJson<PostingRecord, Record<string, never>>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/duplicate`,
      {},
    );
  },

  publish(postingId: string): Promise<PostingLifecycleRecord> {
    return authenticatedJson<PostingLifecycleRecord, Record<string, never>>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/publish`,
      {},
    );
  },

  pausePosting(postingId: string): Promise<PostingLifecycleRecord> {
    return authenticatedJson<PostingLifecycleRecord, Record<string, never>>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/pause`,
      {},
    );
  },

  unpausePosting(postingId: string): Promise<PostingLifecycleRecord> {
    return authenticatedJson<PostingLifecycleRecord, Record<string, never>>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/unpause`,
      {},
    );
  },

  archive(postingId: string): Promise<PostingLifecycleRecord> {
    return authenticatedJson<PostingLifecycleRecord, Record<string, never>>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/archive`,
      {},
    );
  },

  getOwnerAnalyticsSummary(
    window: PostingAnalyticsWindow,
  ): Promise<OwnerPostingsAnalyticsSummary> {
    return authenticatedJson<OwnerPostingsAnalyticsSummary>(
      "GET",
      buildPathWithQuery("/postings/analytics/summary", { window }),
    );
  },

  listOwnerAnalytics(input: {
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

  getAnalyticsDetail(
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

  listReviews(
    postingId: string,
    page = 1,
    pageSize = 5,
  ): Promise<ListPublicPostingReviewsResult> {
    return publicJson<ListPublicPostingReviewsResult>(
      "GET",
      buildPathWithQuery(`/postings/${encodeURIComponent(postingId)}/reviews`, {
        page,
        pageSize,
      }),
    );
  },

  getOwnReview(postingId: string): Promise<PostingOwnReviewState> {
    return authenticatedJson<PostingOwnReviewState>(
      "GET",
      `/postings/${encodeURIComponent(postingId)}/reviews/me`,
    );
  },

  createReview(
    postingId: string,
    input: CreatePostingReviewInput,
  ): Promise<PublicPostingReviewRecord> {
    return authenticatedJson<
      PublicPostingReviewRecord,
      CreatePostingReviewInput
    >("POST", `/postings/${encodeURIComponent(postingId)}/reviews`, input);
  },

  updateOwnReview(
    postingId: string,
    input: UpdateOwnPostingReviewInput,
  ): Promise<PublicPostingReviewRecord> {
    return authenticatedJson<
      PublicPostingReviewRecord,
      UpdateOwnPostingReviewInput
    >("PUT", `/postings/${encodeURIComponent(postingId)}/reviews/me`, input);
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

  searchPublic(
    params: PublicPostingSearchParams,
  ): Promise<PublicPostingSearchResult> {
    return publicJson<PublicPostingSearchResult>(
      "GET",
      buildPathWithQuery("/postings", params),
    );
  },

  autocomplete(
    params: PublicPostingAutocompleteParams,
  ): Promise<PublicPostingAutocompleteResult> {
    return publicJson<PublicPostingAutocompleteResult>(
      "GET",
      buildPathWithQuery("/postings/autocomplete", params),
    );
  },

  listRecommendations(
    filters: ListRecommendationsFilters = {},
  ): Promise<PublicPostingSearchResult> {
    return optionalAuthJson<PublicPostingSearchResult>(
      "GET",
      buildPathWithQuery("/postings/recommendations", {
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
        family: filters.family,
        subtype: filters.subtype,
        latitude: filters.latitude,
        longitude: filters.longitude,
        radiusKm: filters.radiusKm,
        startAt: filters.startAt,
        endAt: filters.endAt,
      }),
    );
  },

  batchPublic(
    ids: string[],
  ): Promise<BatchPostingsResult<PublicPostingDetail>> {
    return publicJson<BatchPostingsResult<PublicPostingDetail>>(
      "GET",
      toIdsPath("/postings/batch", ids),
    );
  },

  trackSearchClick(
    postingId: string,
    input: TrackPostingSearchClickInput,
  ): Promise<{ ok: true }> {
    return optionalAuthJson<{ ok: true }, TrackPostingSearchClickInput>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/activity/search-click`,
      input,
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

  listSeasonalPricing(postingId: string): Promise<SeasonalPricingRule[]> {
    return authenticatedJson<SeasonalPricingRule[]>(
      "GET",
      `/postings/${encodeURIComponent(postingId)}/seasonal-pricing`,
    );
  },

  createSeasonalPricingRule(
    postingId: string,
    input: SeasonalPricingRuleInput,
  ): Promise<SeasonalPricingRule> {
    return authenticatedJson<SeasonalPricingRule, SeasonalPricingRuleInput>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/seasonal-pricing`,
      input,
    );
  },

  updateSeasonalPricingRule(
    postingId: string,
    ruleId: string,
    input: SeasonalPricingRuleInput,
  ): Promise<SeasonalPricingRule> {
    return authenticatedJson<SeasonalPricingRule, SeasonalPricingRuleInput>(
      "PATCH",
      `/postings/${encodeURIComponent(postingId)}/seasonal-pricing/${encodeURIComponent(ruleId)}`,
      input,
    );
  },

  deleteSeasonalPricingRule(postingId: string, ruleId: string): Promise<void> {
    return authenticatedJson<void>(
      "DELETE",
      `/postings/${encodeURIComponent(postingId)}/seasonal-pricing/${encodeURIComponent(ruleId)}`,
    );
  },
};
