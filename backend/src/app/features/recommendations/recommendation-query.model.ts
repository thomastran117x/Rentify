import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  postingFamilySchema,
  postingSubtypeSchema,
  type PostingPagination,
  type PublicPostingRecord,
} from "@/features/postings/postings.model";
import type { RecommendationReasonCode } from "@/features/recommendations/recommendation-precompute.model";

export const recommendationModeSchema = z.enum(["personalized", "popular"]);
export const recommendationFallbackReasonSchema = z.enum([
  "missing_snapshot",
  "stale_snapshot",
  "unqualified_profile",
]);

export const recommendationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  family: postingFamilySchema.optional(),
  subtype: postingSubtypeSchema.optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(20_000).optional(),
  startAt: z
    .string()
    .datetime("Recommendation start time must be an ISO datetime.")
    .optional(),
  endAt: z
    .string()
    .datetime("Recommendation end time must be an ISO datetime.")
    .optional(),
});

export type RecommendationMode = z.infer<typeof recommendationModeSchema>;
export type RecommendationFallbackReason = z.infer<
  typeof recommendationFallbackReasonSchema
>;
export type RecommendationQuery = z.infer<typeof recommendationQuerySchema>;

export interface RecommendationQueryInput {
  page: number;
  pageSize: number;
  family?: z.infer<typeof postingFamilySchema>;
  subtype?: z.infer<typeof postingSubtypeSchema>;
  geo?: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
  };
  availabilityWindow?: {
    startAt: string;
    endAt: string;
  };
}

export interface RecommendationItemRecord {
  posting: PublicPostingRecord;
  reasonCodes: RecommendationReasonCode[];
}

export interface RecommendationQueryResult {
  items: RecommendationItemRecord[];
  pagination: PostingPagination;
  mode: RecommendationMode;
  fallback: boolean;
  fallbackReason?: RecommendationFallbackReason;
  snapshotGeneratedAt?: string;
}
