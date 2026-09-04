import { z } from "zod";
import {
  postingFamilySchema,
  postingSubtypeSchema,
  type PostingFamily,
  type PostingSubtype,
} from "@/features/postings/postings.model";
import type { Uuid } from "@/configuration/validation/uuid";

export const recommendationActivityEventTypeSchema = z.enum([
  "posting_view",
  "search_click",
  "booking_request_created",
  "renting_confirmed",
  "posting_published",
  "posting_unpaused",
  "posting_paused",
  "posting_archived",
]);

export const recommendationActivitySourceSchema = z.enum([
  "posting_detail",
  "search_results",
  "booking_flow",
  "renting_flow",
  "posting_lifecycle",
]);

export const recommendationRefreshJobTypeSchema = z.enum([
  "user_refresh",
  "popular_refresh",
]);

export const recommendationPopularSegmentTypeSchema = z.enum([
  "global",
  "family",
  "family_subtype",
]);

export const searchClickActivityRequestSchema = z.object({
  searchSessionId: z.string().trim().min(1).max(255),
  query: z.string().trim().min(1).max(120).optional(),
  family: postingFamilySchema.optional(),
  subtype: postingSubtypeSchema.optional(),
  page: z.coerce.number().int().min(1),
  position: z.coerce.number().int().min(0),
  hasGeoFilter: z.boolean(),
  hasAvailabilityFilter: z.boolean(),
});

export const recommendationActivityEventSchema = z.object({
  eventId: z.string().trim().min(1).max(255),
  eventType: recommendationActivityEventTypeSchema,
  occurredAt: z.string().datetime(),
  postingId: z.string().trim().min(1).max(36),
  actorUserId: z.string().trim().min(1).max(36).nullable().optional(),
  anonymousActorHash: z.string().trim().min(1).max(128).nullable().optional(),
  deviceType: z.enum(["mobile", "tablet", "desktop", "bot", "unknown"]),
  requestId: z.string().trim().min(1).max(255).nullable().optional(),
  source: recommendationActivitySourceSchema,
  searchSessionId: z.string().trim().min(1).max(255).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  personalizationEnabled: z.boolean().nullable().optional(),
});

export type RecommendationActivityEventType = z.infer<
  typeof recommendationActivityEventTypeSchema
>;
export type RecommendationActivitySource = z.infer<
  typeof recommendationActivitySourceSchema
>;
export type RecommendationRefreshJobType = z.infer<
  typeof recommendationRefreshJobTypeSchema
>;
export type RecommendationPopularSegmentType = z.infer<
  typeof recommendationPopularSegmentTypeSchema
>;
export type SearchClickActivityRequestBody = z.infer<
  typeof searchClickActivityRequestSchema
>;
export type RecommendationActivityEventPayload = z.infer<
  typeof recommendationActivityEventSchema
>;

export interface RecommendationPostingSummary {
  id: Uuid;
  organizationId: Uuid;
  family: PostingFamily;
  subtype: PostingSubtype;
}

export interface PersistRecommendationActivityInput {
  id: Uuid;
  aggregationKey: string;
  eventType: RecommendationActivityEventType;
  source: RecommendationActivitySource;
  occurredAt: Date;
  postingId: Uuid;
  organizationId: Uuid;
  actorUserId?: Uuid;
  anonymousActorHash?: string;
  deviceType: string;
  requestId?: string;
  searchSessionId?: string;
  metadata?: Record<string, unknown>;
  count: number;
  firstOccurredAt: Date;
  lastOccurredAt: Date;
  personalizationEligible: boolean;
  coalesced: boolean;
}

export interface UpsertRecommendationRefreshJobInput {
  jobType: RecommendationRefreshJobType;
  dedupeKey: string;
  userId?: Uuid;
  segmentType?: RecommendationPopularSegmentType;
  segmentValue?: string;
  availableAt: Date;
}
