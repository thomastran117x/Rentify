import type { RecommendationActivityEventType } from "@/features/recommendations/recommendation-activity.model";
import type { PostingAvailabilityStatus } from "@/features/postings/postings.model";

export const PERSONALIZED_RECOMMENDATION_LOOKBACK_DAYS = 90;
export const POPULAR_RECOMMENDATION_LOOKBACK_DAYS = 30;
export const PERSONALIZED_RECOMMENDATION_STALE_HOURS = 24;
export const POPULAR_RECOMMENDATION_STALE_HOURS = 6;

export const PERSONALIZED_RECOMMENDATION_LIMIT = 250;
export const POPULAR_RECOMMENDATION_LIMITS = {
  global: 300,
  family: 200,
  family_subtype: 150,
} as const;

export const RECOMMENDATION_EVENT_WEIGHTS: Record<
  RecommendationActivityEventType,
  number
> = {
  posting_view: 1,
  search_click: 2,
  booking_request_created: 5,
  renting_confirmed: 8,
  posting_published: 0,
  posting_unpaused: 0,
  posting_paused: 0,
  posting_archived: 0,
};

export const RECOMMENDATION_RECENCY_MULTIPLIERS = [
  {
    maxAgeDays: 7,
    multiplier: 1,
  },
  {
    maxAgeDays: 30,
    multiplier: 0.7,
  },
  {
    maxAgeDays: 90,
    multiplier: 0.4,
  },
] as const;

export const PERSONALIZED_RECOMMENDATION_WEIGHTS = {
  subtypeAffinity: 40,
  familyAffinity: 30,
  tagAffinity: 20,
  popularity: 15,
  freshness: 10,
  availabilityBiasByStatus: {
    available: 8,
    limited: 3,
    unavailable: 0,
  } satisfies Record<PostingAvailabilityStatus, number>,
  viewedPenalty: 12,
} as const;

export const POPULAR_RECOMMENDATION_WEIGHTS = {
  activity: 70,
  freshness: 20,
  availabilityBiasByStatus: {
    available: 8,
    limited: 3,
    unavailable: 0,
  } satisfies Record<PostingAvailabilityStatus, number>,
} as const;

export const RECOMMENDATION_REASON_CODE_THRESHOLDS = {
  fresh: 0.5,
  popular: 0.35,
} as const;
