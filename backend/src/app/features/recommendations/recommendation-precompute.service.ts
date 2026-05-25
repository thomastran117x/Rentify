import {
  PERSONALIZED_RECOMMENDATION_LIMIT,
  PERSONALIZED_RECOMMENDATION_LOOKBACK_DAYS,
  PERSONALIZED_RECOMMENDATION_STALE_HOURS,
  PERSONALIZED_RECOMMENDATION_WEIGHTS,
  POPULAR_RECOMMENDATION_LIMITS,
  POPULAR_RECOMMENDATION_LOOKBACK_DAYS,
  POPULAR_RECOMMENDATION_STALE_HOURS,
  POPULAR_RECOMMENDATION_WEIGHTS,
  RECOMMENDATION_EVENT_WEIGHTS,
  RECOMMENDATION_REASON_CODE_THRESHOLDS,
  RECOMMENDATION_RECENCY_MULTIPLIERS,
} from "@/features/recommendations/recommendation-ranking.constants";
import type { RecommendationPrecomputeRepository } from "@/features/recommendations/recommendation-precompute.repository";
import type {
  RecommendationActivityRow,
  RecommendationAffinityScore,
  RecommendationCandidateRecord,
  RecommendationPopularSegmentRecord,
  RecommendationPostingCandidate,
  RecommendationReasonCode,
  RecommendationRefreshJobRecord,
  RecommendationSignalCounts,
  UserRecommendationProfileRecord,
  UserRecommendationSnapshotRecord,
} from "@/features/recommendations/recommendation-precompute.model";
import type { RecommendationPopularSegmentType } from "@/features/recommendations/recommendation-activity.model";
import {
  isPostingFamilyValue,
  isPostingSubtypeValue,
} from "@/features/postings/postings.variants";

interface CandidateScoreParts {
  posting: RecommendationPostingCandidate;
  rawSubtypeAffinity: number;
  rawFamilyAffinity: number;
  rawTagAffinity: number;
  rawPopularity: number;
  freshness: number;
  availabilityBias: number;
  viewedPenalty: number;
  viewed: boolean;
}

interface PopularCandidateScoreParts {
  posting: RecommendationPostingCandidate;
  rawActivity: number;
  freshness: number;
  availabilityBias: number;
}

interface PopularSegmentFilter {
  family?: RecommendationPostingCandidate["family"];
  subtype?: RecommendationPostingCandidate["subtype"];
}

export class RecommendationPrecomputeService {
  constructor(
    private readonly repository: RecommendationPrecomputeRepository,
  ) {}

  async processBatch(limit: number): Promise<number> {
    await this.enqueueMissingOrStalePopularJobs();

    const jobs = await this.repository.claimRefreshJobBatch(limit);

    for (const job of jobs) {
      try {
        await this.processJob(job);
        await this.repository.markRefreshJobProcessed(job.id);
      } catch (error) {
        await this.repository.markRefreshJobRetry(
          job.id,
          job.attempts + 1,
          error instanceof Error
            ? error.message
            : "Unknown recommendation precompute error.",
        );
      }
    }

    return jobs.length;
  }

  async enqueueMissingOrStalePopularJobs(
    now: Date = new Date(),
  ): Promise<void> {
    const [segments, freshness] = await Promise.all([
      this.repository.listPublishedPopularSegments(),
      this.repository.listPopularSnapshotFreshness(),
    ]);
    const freshnessByKey = new Map(
      freshness.map((snapshot) => [
        this.createPopularSegmentKey(
          snapshot.segmentType,
          snapshot.segmentValue,
        ),
        new Date(snapshot.generatedAt),
      ]),
    );
    const staleBefore = new Date(
      now.getTime() - POPULAR_RECOMMENDATION_STALE_HOURS * 60 * 60 * 1000,
    );
    const jobs = segments.flatMap((segment) => {
      const key = this.createPopularSegmentKey(
        segment.segmentType,
        segment.segmentValue,
      );
      const generatedAt = freshnessByKey.get(key);

      if (generatedAt && generatedAt >= staleBefore) {
        return [];
      }

      return [
        {
          jobType: "popular_refresh" as const,
          dedupeKey: this.createPopularRefreshDedupeKey(
            segment.segmentType,
            segment.segmentValue,
          ),
          segmentType: segment.segmentType,
          segmentValue: segment.segmentValue,
          availableAt: now,
        },
      ];
    });

    if (jobs.length === 0) {
      return;
    }

    await this.repository.enqueueRefreshJobs(jobs);
  }

  private async processJob(job: RecommendationRefreshJobRecord): Promise<void> {
    if (job.jobType === "user_refresh") {
      if (!job.userId) {
        throw new Error("User recommendation refresh job is missing a userId.");
      }

      await this.rebuildUserRecommendations(job.userId);
      return;
    }

    if (job.jobType !== "popular_refresh") {
      throw new Error(
        `Unsupported recommendation refresh job type: ${job.jobType}`,
      );
    }

    const segment = this.parsePopularSegmentJob(
      job.segmentType,
      job.segmentValue,
    );
    await this.rebuildPopularRecommendations(segment);
  }

  private async rebuildUserRecommendations(userId: string): Promise<void> {
    const now = new Date();
    const activityWindowStart = this.createLookbackStart(
      now,
      PERSONALIZED_RECOMMENDATION_LOOKBACK_DAYS,
    );
    const popularityWindowStart = this.createLookbackStart(
      now,
      POPULAR_RECOMMENDATION_LOOKBACK_DAYS,
    );
    const [activities, popularityRows, candidates] = await Promise.all([
      this.repository.listUserActivityRows(userId, activityWindowStart),
      this.repository.listPopularActivityRows(popularityWindowStart),
      this.repository.listPublishedRecommendationCandidates({
        excludeOwnerId: userId,
      }),
    ]);

    const profile = this.buildUserProfile(
      userId,
      activityWindowStart,
      now,
      activities,
    );

    if (!profile.qualified) {
      await this.repository.upsertUserRecommendationArtifacts({
        profile,
      });
      return;
    }

    const popularityByPosting = this.buildActivityScoreByPosting(
      popularityRows,
      now,
    );
    const snapshot = this.buildUserSnapshot(
      profile,
      now,
      candidates,
      popularityByPosting,
      activities,
    );

    await this.repository.upsertUserRecommendationArtifacts({
      profile,
      snapshot,
    });
  }

  private async rebuildPopularRecommendations(
    segment: RecommendationPopularSegmentRecord,
  ): Promise<void> {
    const now = new Date();
    const windowStart = this.createLookbackStart(
      now,
      POPULAR_RECOMMENDATION_LOOKBACK_DAYS,
    );
    const [activityRows, candidates] = await Promise.all([
      this.repository.listPopularActivityRows(windowStart),
      this.repository.listPublishedRecommendationCandidates(
        this.createSegmentFilter(segment),
      ),
    ]);
    const filteredActivityRows = activityRows.filter((row) =>
      this.matchesSegment(row, segment),
    );
    const activityByPosting = this.buildActivityScoreByPosting(
      filteredActivityRows,
      now,
    );
    const candidateParts = candidates.map((posting) => ({
      posting,
      rawActivity: activityByPosting.get(posting.id) ?? 0,
      freshness: this.calculateFreshness(posting.publishedAt, now),
      availabilityBias:
        POPULAR_RECOMMENDATION_WEIGHTS.availabilityBiasByStatus[
          posting.availabilityStatus
        ],
    }));
    const normalizedActivity = this.normalizeComponentMap(
      candidateParts.map((part) => ({
        postingId: part.posting.id,
        value: part.rawActivity,
      })),
    );
    const candidatesPayload = candidateParts
      .map((part) => {
        const activity = normalizedActivity.get(part.posting.id) ?? 0;
        const score =
          POPULAR_RECOMMENDATION_WEIGHTS.activity * activity +
          POPULAR_RECOMMENDATION_WEIGHTS.freshness * part.freshness +
          part.availabilityBias;
        const reasonCodes = this.buildPopularReasonCodes(
          part.posting,
          activity,
          part.freshness,
        );

        return {
          postingId: part.posting.id,
          score: this.roundScore(score),
          reasonCodes,
          publishedAtMs: this.readPublishedAtMs(part.posting.publishedAt),
        };
      })
      .sort((left, right) => this.compareScoredCandidates(left, right))
      .slice(0, POPULAR_RECOMMENDATION_LIMITS[segment.segmentType])
      .map<RecommendationCandidateRecord>(
        ({ postingId, score, reasonCodes }) => ({
          postingId,
          score,
          reasonCodes,
        }),
      );

    const latestSignalAt = this.readLatestSignalAt(filteredActivityRows);

    await this.repository.upsertPopularRecommendationSnapshot({
      segmentType: segment.segmentType,
      segmentValue: segment.segmentValue,
      generatedAt: now.toISOString(),
      sourceLastSignalAt: latestSignalAt?.toISOString(),
      candidateCount: candidatesPayload.length,
      candidates: candidatesPayload,
    });
  }

  private buildUserProfile(
    userId: string,
    activityWindowStart: Date,
    now: Date,
    activities: RecommendationActivityRow[],
  ): UserRecommendationProfileRecord {
    const signalCounts = this.repository.createEmptySignalCounts();
    const familyScores = new Map<string, number>();
    const subtypeScores = new Map<string, number>();
    const tagScores = new Map<string, number>();
    const distinctPostingIds = new Set<string>();
    let lastSignalAt: Date | undefined;
    let hasStrongSignal = false;

    for (const activity of activities) {
      distinctPostingIds.add(activity.postingId);
      const signalKey = activity.eventType as keyof RecommendationSignalCounts;
      signalCounts[signalKey] += activity.count;

      const occurredAt = new Date(activity.lastOccurredAt);
      if (!lastSignalAt || occurredAt > lastSignalAt) {
        lastSignalAt = occurredAt;
      }

      if (
        activity.eventType === "booking_request_created" ||
        activity.eventType === "renting_confirmed"
      ) {
        hasStrongSignal = true;
      }

      const signalScore = this.calculateActivityScore(activity, now);
      this.incrementScore(familyScores, activity.family, signalScore);
      this.incrementScore(subtypeScores, activity.subtype, signalScore);

      for (const tag of activity.tags) {
        this.incrementScore(tagScores, tag, signalScore);
      }
    }

    return {
      userId,
      qualified: distinctPostingIds.size >= 2 || hasStrongSignal,
      activityWindowStartAt: activityWindowStart.toISOString(),
      lastSignalAt: lastSignalAt?.toISOString(),
      distinctPostingCount: distinctPostingIds.size,
      signalCounts,
      familyAffinities: this.toSortedAffinityScores(familyScores),
      subtypeAffinities: this.toSortedAffinityScores(subtypeScores),
      tagAffinities: this.toSortedAffinityScores(tagScores),
      rebuiltAt: now.toISOString(),
    };
  }

  private buildUserSnapshot(
    profile: UserRecommendationProfileRecord,
    now: Date,
    candidates: RecommendationPostingCandidate[],
    popularityByPosting: Map<string, number>,
    activities: RecommendationActivityRow[],
  ): UserRecommendationSnapshotRecord {
    const familyAffinities = this.toAffinityMap(profile.familyAffinities);
    const subtypeAffinities = this.toAffinityMap(profile.subtypeAffinities);
    const tagAffinities = this.toAffinityMap(profile.tagAffinities);
    const viewedPostingIds = new Set(
      activities
        .filter(
          (activity) =>
            activity.eventType === "posting_view" ||
            activity.eventType === "search_click",
        )
        .map((activity) => activity.postingId),
    );

    const parts = candidates.map<CandidateScoreParts>((posting) => ({
      posting,
      rawSubtypeAffinity: subtypeAffinities.get(posting.subtype) ?? 0,
      rawFamilyAffinity: familyAffinities.get(posting.family) ?? 0,
      rawTagAffinity: posting.tags.reduce(
        (total, tag) => total + (tagAffinities.get(tag) ?? 0),
        0,
      ),
      rawPopularity: popularityByPosting.get(posting.id) ?? 0,
      freshness: this.calculateFreshness(posting.publishedAt, now),
      availabilityBias:
        PERSONALIZED_RECOMMENDATION_WEIGHTS.availabilityBiasByStatus[
          posting.availabilityStatus
        ],
      viewedPenalty: viewedPostingIds.has(posting.id)
        ? PERSONALIZED_RECOMMENDATION_WEIGHTS.viewedPenalty
        : 0,
      viewed: viewedPostingIds.has(posting.id),
    }));

    const normalizedSubtypeAffinity = this.normalizeComponentMap(
      parts.map((part) => ({
        postingId: part.posting.id,
        value: part.rawSubtypeAffinity,
      })),
    );
    const normalizedFamilyAffinity = this.normalizeComponentMap(
      parts.map((part) => ({
        postingId: part.posting.id,
        value: part.rawFamilyAffinity,
      })),
    );
    const normalizedTagAffinity = this.normalizeComponentMap(
      parts.map((part) => ({
        postingId: part.posting.id,
        value: part.rawTagAffinity,
      })),
    );
    const normalizedPopularity = this.normalizeComponentMap(
      parts.map((part) => ({
        postingId: part.posting.id,
        value: part.rawPopularity,
      })),
    );

    const candidatesPayload = parts
      .map((part) => {
        const subtype = normalizedSubtypeAffinity.get(part.posting.id) ?? 0;
        const family = normalizedFamilyAffinity.get(part.posting.id) ?? 0;
        const tag = normalizedTagAffinity.get(part.posting.id) ?? 0;
        const popularity = normalizedPopularity.get(part.posting.id) ?? 0;
        const score =
          PERSONALIZED_RECOMMENDATION_WEIGHTS.subtypeAffinity * subtype +
          PERSONALIZED_RECOMMENDATION_WEIGHTS.familyAffinity * family +
          PERSONALIZED_RECOMMENDATION_WEIGHTS.tagAffinity * tag +
          PERSONALIZED_RECOMMENDATION_WEIGHTS.popularity * popularity +
          PERSONALIZED_RECOMMENDATION_WEIGHTS.freshness * part.freshness +
          part.availabilityBias -
          part.viewedPenalty;

        return {
          postingId: part.posting.id,
          score: this.roundScore(score),
          reasonCodes: this.buildPersonalizedReasonCodes(
            part,
            subtype,
            family,
            tag,
            popularity,
          ),
          publishedAtMs: this.readPublishedAtMs(part.posting.publishedAt),
        };
      })
      .sort((left, right) => this.compareScoredCandidates(left, right))
      .slice(0, PERSONALIZED_RECOMMENDATION_LIMIT)
      .map<RecommendationCandidateRecord>(
        ({ postingId, score, reasonCodes }) => ({
          postingId,
          score,
          reasonCodes,
        }),
      );

    return {
      userId: profile.userId,
      generatedAt: now.toISOString(),
      sourceLastSignalAt: profile.lastSignalAt,
      candidateCount: candidatesPayload.length,
      candidates: candidatesPayload,
    };
  }

  private buildActivityScoreByPosting(
    rows: RecommendationActivityRow[],
    now: Date,
  ): Map<string, number> {
    const totals = new Map<string, number>();

    for (const row of rows) {
      this.incrementScore(
        totals,
        row.postingId,
        this.calculateActivityScore(row, now),
      );
    }

    return totals;
  }

  private calculateActivityScore(
    activity: RecommendationActivityRow,
    now: Date,
  ): number {
    const weight = RECOMMENDATION_EVENT_WEIGHTS[activity.eventType] ?? 0;
    const multiplier = this.readRecencyMultiplier(activity.lastOccurredAt, now);

    return weight * activity.count * multiplier;
  }

  private readRecencyMultiplier(occurredAtIso: string, now: Date): number {
    const occurredAt = new Date(occurredAtIso);
    const ageDays = Math.max(
      0,
      (now.getTime() - occurredAt.getTime()) / (24 * 60 * 60 * 1000),
    );

    for (const bucket of RECOMMENDATION_RECENCY_MULTIPLIERS) {
      if (ageDays <= bucket.maxAgeDays) {
        return bucket.multiplier;
      }
    }

    return 0;
  }

  private calculateFreshness(
    publishedAtIso: string | undefined,
    now: Date,
  ): number {
    if (!publishedAtIso) {
      return 0;
    }

    const publishedAt = new Date(publishedAtIso);
    const ageMs = now.getTime() - publishedAt.getTime();
    const maxAgeMs = POPULAR_RECOMMENDATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

    if (ageMs <= 0) {
      return 1;
    }

    return Math.max(0, 1 - ageMs / maxAgeMs);
  }

  private normalizeComponentMap(
    entries: Array<{ postingId: string; value: number }>,
  ): Map<string, number> {
    const maxValue = entries.reduce(
      (currentMax, entry) => Math.max(currentMax, entry.value),
      0,
    );
    const normalized = new Map<string, number>();

    for (const entry of entries) {
      normalized.set(
        entry.postingId,
        maxValue > 0 ? entry.value / maxValue : 0,
      );
    }

    return normalized;
  }

  private buildPersonalizedReasonCodes(
    part: CandidateScoreParts,
    subtypeAffinity: number,
    familyAffinity: number,
    tagAffinity: number,
    popularity: number,
  ): RecommendationReasonCode[] {
    const reasonCodes: RecommendationReasonCode[] = [];

    if (subtypeAffinity > 0) {
      reasonCodes.push("matched_subtype");
    }

    if (familyAffinity > 0) {
      reasonCodes.push("matched_family");
    }

    if (tagAffinity > 0) {
      reasonCodes.push("matched_tag");
    }

    if (popularity >= RECOMMENDATION_REASON_CODE_THRESHOLDS.popular) {
      reasonCodes.push("popular");
    }

    if (part.freshness >= RECOMMENDATION_REASON_CODE_THRESHOLDS.fresh) {
      reasonCodes.push("fresh");
    }

    if (part.posting.availabilityStatus === "limited") {
      reasonCodes.push("limited_availability");
    }

    if (part.viewed) {
      reasonCodes.push("previously_viewed");
    }

    return reasonCodes;
  }

  private buildPopularReasonCodes(
    posting: RecommendationPostingCandidate,
    normalizedActivity: number,
    freshness: number,
  ): RecommendationReasonCode[] {
    const reasonCodes: RecommendationReasonCode[] = [];

    if (normalizedActivity >= RECOMMENDATION_REASON_CODE_THRESHOLDS.popular) {
      reasonCodes.push("popular");
    }

    if (freshness >= RECOMMENDATION_REASON_CODE_THRESHOLDS.fresh) {
      reasonCodes.push("fresh");
    }

    if (posting.availabilityStatus === "limited") {
      reasonCodes.push("limited_availability");
    }

    return reasonCodes;
  }

  private toSortedAffinityScores(
    scores: Map<string, number>,
  ): RecommendationAffinityScore[] {
    const maxScore = [...scores.values()].reduce(
      (currentMax, value) => Math.max(currentMax, value),
      0,
    );

    return [...scores.entries()]
      .map(([value, score]) => ({
        value,
        score: maxScore > 0 ? this.roundScore(score / maxScore) : 0,
      }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.value.localeCompare(right.value);
      });
  }

  private toAffinityMap(
    scores: RecommendationAffinityScore[],
  ): Map<string, number> {
    return new Map(scores.map((entry) => [entry.value, entry.score]));
  }

  private incrementScore(
    scores: Map<string, number>,
    key: string,
    amount: number,
  ): void {
    scores.set(key, (scores.get(key) ?? 0) + amount);
  }

  private readLatestSignalAt(
    rows: RecommendationActivityRow[],
  ): Date | undefined {
    return rows.reduce<Date | undefined>((latest, row) => {
      const occurredAt = new Date(row.lastOccurredAt);
      return !latest || occurredAt > latest ? occurredAt : latest;
    }, undefined);
  }

  private createLookbackStart(now: Date, lookbackDays: number): Date {
    return new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  }

  private createSegmentFilter(
    segment: RecommendationPopularSegmentRecord,
  ): PopularSegmentFilter | undefined {
    if (segment.segmentType === "global") {
      return undefined;
    }

    if (segment.segmentType === "family") {
      return {
        family:
          segment.segmentValue as RecommendationPostingCandidate["family"],
      };
    }

    const [family, subtype] = segment.segmentValue.split(":");
    return {
      family: family as RecommendationPostingCandidate["family"],
      subtype: subtype as RecommendationPostingCandidate["subtype"],
    };
  }

  private matchesSegment(
    row: RecommendationActivityRow,
    segment: RecommendationPopularSegmentRecord,
  ): boolean {
    if (segment.segmentType === "global") {
      return true;
    }

    if (segment.segmentType === "family") {
      return row.family === segment.segmentValue;
    }

    const [family, subtype] = segment.segmentValue.split(":");
    return row.family === family && row.subtype === subtype;
  }

  private parsePopularSegmentJob(
    segmentType: RecommendationPopularSegmentType | undefined,
    segmentValue: string | undefined,
  ): RecommendationPopularSegmentRecord {
    if (!segmentType || !segmentValue) {
      throw new Error(
        "Popular recommendation refresh job is missing segment metadata.",
      );
    }

    if (segmentType === "global") {
      return {
        segmentType,
        segmentValue: "global",
      };
    }

    if (segmentType === "family") {
      if (!isPostingFamilyValue(segmentValue)) {
        throw new Error(
          `Invalid family recommendation segment: ${segmentValue}`,
        );
      }

      return {
        segmentType,
        segmentValue,
      };
    }

    const [family, subtype] = segmentValue.split(":");
    if (!isPostingFamilyValue(family) || !isPostingSubtypeValue(subtype)) {
      throw new Error(
        `Invalid family_subtype recommendation segment: ${segmentValue}`,
      );
    }

    return {
      segmentType,
      segmentValue: `${family}:${subtype}`,
    };
  }

  private createPopularRefreshDedupeKey(
    segmentType: RecommendationPopularSegmentType,
    segmentValue: string,
  ): string {
    if (segmentType === "global") {
      return "popular:global";
    }

    return `popular:${segmentType}:${segmentValue}`;
  }

  private createPopularSegmentKey(
    segmentType: RecommendationPopularSegmentType,
    segmentValue: string,
  ): string {
    return `${segmentType}:${segmentValue}`;
  }

  private compareScoredCandidates(
    left: { score: number; publishedAtMs: number; postingId: string },
    right: { score: number; publishedAtMs: number; postingId: string },
  ): number {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.publishedAtMs !== left.publishedAtMs) {
      return right.publishedAtMs - left.publishedAtMs;
    }

    return left.postingId.localeCompare(right.postingId);
  }

  private readPublishedAtMs(publishedAtIso: string | undefined): number {
    return publishedAtIso ? new Date(publishedAtIso).getTime() : 0;
  }

  private roundScore(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
  }
}
