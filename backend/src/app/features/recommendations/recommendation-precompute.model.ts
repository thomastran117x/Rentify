import type {
  RecommendationActivityEventType,
  RecommendationPopularSegmentType,
  RecommendationRefreshJobType,
} from "@/features/recommendations/recommendation-activity.model";
import type {
  PostingAvailabilityStatus,
  PostingFamily,
  PostingSubtype,
} from "@/features/postings/postings.model";
import type { Uuid } from "@/configuration/validation/uuid";

export type RecommendationReasonCode =
  | "matched_subtype"
  | "matched_family"
  | "matched_tag"
  | "popular"
  | "fresh"
  | "limited_availability"
  | "previously_viewed";

export interface RecommendationAffinityScore {
  value: string;
  score: number;
}

export interface RecommendationCandidateRecord {
  postingId: Uuid;
  score: number;
  reasonCodes: RecommendationReasonCode[];
}

export interface RecommendationSignalCounts {
  posting_view: number;
  search_click: number;
  booking_request_created: number;
  renting_confirmed: number;
}

export interface RecommendationRefreshJobRecord {
  id: Uuid;
  jobType: RecommendationRefreshJobType;
  userId?: Uuid;
  segmentType?: RecommendationPopularSegmentType;
  segmentValue?: string;
  attempts: number;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationActivityRow {
  postingId: Uuid;
  eventType: RecommendationActivityEventType;
  count: number;
  lastOccurredAt: string;
  family: PostingFamily;
  subtype: PostingSubtype;
  tags: string[];
}

export interface RecommendationPostingCandidate {
  id: Uuid;
  organizationId: Uuid;
  family: PostingFamily;
  subtype: PostingSubtype;
  tags: string[];
  availabilityStatus: PostingAvailabilityStatus;
  publishedAt?: string;
}

export interface UserRecommendationProfileRecord {
  userId: Uuid;
  qualified: boolean;
  activityWindowStartAt: string;
  lastSignalAt?: string;
  distinctPostingCount: number;
  signalCounts: RecommendationSignalCounts;
  familyAffinities: RecommendationAffinityScore[];
  subtypeAffinities: RecommendationAffinityScore[];
  tagAffinities: RecommendationAffinityScore[];
  rebuiltAt: string;
}

export interface UserRecommendationSnapshotRecord {
  userId: Uuid;
  generatedAt: string;
  sourceLastSignalAt?: string;
  candidateCount: number;
  candidates: RecommendationCandidateRecord[];
}

export interface PopularRecommendationSnapshotRecord {
  segmentType: RecommendationPopularSegmentType;
  segmentValue: string;
  generatedAt: string;
  sourceLastSignalAt?: string;
  candidateCount: number;
  candidates: RecommendationCandidateRecord[];
}

export interface UpsertUserRecommendationArtifactsInput {
  profile: UserRecommendationProfileRecord;
  snapshot?: UserRecommendationSnapshotRecord;
}

export interface UpsertPopularRecommendationSnapshotInput
  extends PopularRecommendationSnapshotRecord {}

export interface RecommendationPopularSegmentRecord {
  segmentType: RecommendationPopularSegmentType;
  segmentValue: string;
}

export interface RecommendationPopularSnapshotFreshnessRecord
  extends RecommendationPopularSegmentRecord {
  generatedAt: string;
}
