import { randomUUID } from "node:crypto";
import type { RecommendationActivityRepository } from "@/features/recommendations/recommendation-activity.repository";
import type {
  PersistRecommendationActivityInput,
  RecommendationActivityEventPayload,
  RecommendationActivityEventType,
  RecommendationPostingSummary,
  UpsertRecommendationRefreshJobInput,
} from "@/features/recommendations/recommendation-activity.model";

const COALESCE_EVENT_TYPES = new Set<RecommendationActivityEventType>([
  "posting_view",
  "search_click",
]);

export class RecommendationActivityProcessor {
  constructor(private readonly repository: RecommendationActivityRepository) {}

  async process(payload: RecommendationActivityEventPayload): Promise<void> {
    const posting = await this.repository.findPostingSummary(payload.postingId);

    if (!posting) {
      throw new Error(
        `Posting ${payload.postingId} could not be resolved for recommendation activity.`,
      );
    }

    const occurredAt = new Date(payload.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new Error(
        "Recommendation activity occurredAt must be a valid ISO datetime.",
      );
    }

    const personalizationEligible = this.isPersonalizationEligible(payload);
    const activity = this.buildActivity(
      payload,
      posting,
      occurredAt,
      personalizationEligible,
    );
    const jobs = this.buildRefreshJobs(
      payload,
      posting,
      occurredAt,
      personalizationEligible,
    );

    await this.repository.persistActivityAndRefreshJobs(activity, jobs);
  }

  private isPersonalizationEligible(
    payload: RecommendationActivityEventPayload,
  ): boolean {
    if (
      ![
        "posting_view",
        "search_click",
        "booking_request_created",
        "renting_confirmed",
      ].includes(payload.eventType)
    ) {
      return false;
    }

    return Boolean(payload.actorUserId && payload.personalizationEnabled);
  }

  private buildActivity(
    payload: RecommendationActivityEventPayload,
    posting: RecommendationPostingSummary,
    occurredAt: Date,
    personalizationEligible: boolean,
  ): PersistRecommendationActivityInput {
    const coalesced = COALESCE_EVENT_TYPES.has(payload.eventType);
    const aggregationKey = coalesced
      ? this.createCoalescedAggregationKey(payload, occurredAt)
      : payload.eventId;

    return {
      id: randomUUID(),
      aggregationKey,
      eventType: payload.eventType,
      source: payload.source,
      occurredAt,
      postingId: posting.id,
      ownerId: posting.ownerId,
      actorUserId: payload.actorUserId ?? undefined,
      anonymousActorHash: payload.anonymousActorHash ?? undefined,
      deviceType: payload.deviceType,
      requestId: payload.requestId ?? undefined,
      searchSessionId: payload.searchSessionId ?? undefined,
      metadata: payload.metadata,
      count: 1,
      firstOccurredAt: occurredAt,
      lastOccurredAt: occurredAt,
      personalizationEligible,
      coalesced,
    };
  }

  private buildRefreshJobs(
    payload: RecommendationActivityEventPayload,
    posting: RecommendationPostingSummary,
    occurredAt: Date,
    personalizationEligible: boolean,
  ): UpsertRecommendationRefreshJobInput[] {
    const jobs: UpsertRecommendationRefreshJobInput[] = [];

    if (personalizationEligible && payload.actorUserId) {
      jobs.push({
        jobType: "user_refresh",
        dedupeKey: `user:${payload.actorUserId}`,
        userId: payload.actorUserId,
        availableAt: occurredAt,
      });
    }

    jobs.push({
      jobType: "popular_refresh",
      dedupeKey: "popular:global",
      segmentType: "global",
      segmentValue: "global",
      availableAt: occurredAt,
    });
    jobs.push({
      jobType: "popular_refresh",
      dedupeKey: `popular:family:${posting.family}`,
      segmentType: "family",
      segmentValue: posting.family,
      availableAt: occurredAt,
    });
    jobs.push({
      jobType: "popular_refresh",
      dedupeKey: `popular:family_subtype:${posting.family}:${posting.subtype}`,
      segmentType: "family_subtype",
      segmentValue: `${posting.family}:${posting.subtype}`,
      availableAt: occurredAt,
    });

    return jobs;
  }

  private createCoalescedAggregationKey(
    payload: RecommendationActivityEventPayload,
    occurredAt: Date,
  ): string {
    const actorKey = payload.actorUserId
      ? `user:${payload.actorUserId}`
      : `anon:${payload.anonymousActorHash ?? "unknown"}`;
    const bucketStart = this.createBucketStart(occurredAt).toISOString();

    return [
      payload.eventType,
      payload.source,
      payload.postingId,
      actorKey,
      bucketStart,
    ].join("|");
  }

  private createBucketStart(date: Date): Date {
    const bucketMs = 15 * 60 * 1000;
    return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs);
  }
}
