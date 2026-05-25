import type { AuthPrincipal } from "@/features/auth/auth.principal";
import type {
  PostingFamily,
  PostingPagination,
  PostingSubtype,
  PublicPostingRecord,
} from "@/features/postings/postings.model";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import {
  PERSONALIZED_RECOMMENDATION_STALE_HOURS,
  POPULAR_RECOMMENDATION_STALE_HOURS,
} from "@/features/recommendations/recommendation-ranking.constants";
import type {
  PopularRecommendationSnapshotRecord,
  RecommendationCandidateRecord,
  UserRecommendationProfileRecord,
  UserRecommendationSnapshotRecord,
} from "@/features/recommendations/recommendation-precompute.model";
import type {
  RecommendationFallbackReason,
  RecommendationItemRecord,
  RecommendationMode,
  RecommendationQueryInput,
  RecommendationQueryResult,
} from "@/features/recommendations/recommendation-query.model";
import type { RecommendationQueryRepository } from "@/features/recommendations/recommendation-query.repository";

interface SnapshotSelection {
  mode: RecommendationMode;
  fallback: boolean;
  fallbackReason?: RecommendationFallbackReason;
  snapshot: {
    generatedAt?: string;
    candidates: RecommendationCandidateRecord[];
  };
}

export class RecommendationQueryService {
  constructor(
    private readonly repository: RecommendationQueryRepository,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
  ) {}

  async getRecommendations(
    input: RecommendationQueryInput,
    auth: AuthPrincipal | null,
  ): Promise<RecommendationQueryResult> {
    const snapshotSelection = await this.selectSnapshot(input, auth);
    const excludedPostingIds = auth?.sub
      ? await this.repository.listExcludedPostingIdsForUser(auth.sub)
      : new Set<string>();

    let candidateRecords = snapshotSelection.snapshot.candidates.filter(
      (candidate) => !excludedPostingIds.has(candidate.postingId),
    );

    if (input.availabilityWindow) {
      const eligibleIds =
        await this.repository.filterCandidateIdsByAvailabilityWindow({
          candidateIds: candidateRecords.map(
            (candidate) => candidate.postingId,
          ),
          startAt: new Date(input.availabilityWindow.startAt),
          endAt: new Date(input.availabilityWindow.endAt),
        });
      const eligibleIdSet = new Set(eligibleIds);
      candidateRecords = candidateRecords.filter((candidate) =>
        eligibleIdSet.has(candidate.postingId),
      );
    }

    const batch = await this.postingsPublicCacheService.getPublicByIds(
      candidateRecords.map((candidate) => candidate.postingId),
    );
    const reasonCodesByPostingId = new Map(
      candidateRecords.map((candidate) => [
        candidate.postingId,
        candidate.reasonCodes,
      ]),
    );
    const filteredItems = batch.postings
      .filter((posting) => this.matchesFilters(posting, input))
      .map<RecommendationItemRecord>((posting) => ({
        posting,
        reasonCodes: reasonCodesByPostingId.get(posting.id) ?? [],
      }));

    const pagination = this.createPagination(
      input.page,
      input.pageSize,
      filteredItems.length,
    );
    const startIndex = (input.page - 1) * input.pageSize;
    const pagedItems = filteredItems.slice(
      startIndex,
      startIndex + input.pageSize,
    );

    return {
      items: pagedItems,
      pagination,
      mode: snapshotSelection.mode,
      fallback: snapshotSelection.fallback,
      fallbackReason: snapshotSelection.fallbackReason,
      snapshotGeneratedAt: snapshotSelection.snapshot.generatedAt,
    };
  }

  private async selectSnapshot(
    input: RecommendationQueryInput,
    auth: AuthPrincipal | null,
  ): Promise<SnapshotSelection> {
    if (auth?.authMethod === "jwt") {
      const personalization = await this.repository.getPersonalizationContext(
        auth.sub,
      );

      if (!personalization.recommendationPersonalizationEnabled) {
        return this.selectPopularSnapshot(input);
      }

      const personalizedSelection = this.readPersonalizedSelection(
        personalization.profile,
        personalization.snapshot,
      );

      if (personalizedSelection) {
        return personalizedSelection;
      }

      return this.selectPopularSnapshot(
        input,
        this.readPersonalizedFallbackReason(
          personalization.profile,
          personalization.snapshot,
        ),
      );
    }

    return this.selectPopularSnapshot(input);
  }

  private readPersonalizedSelection(
    profile: UserRecommendationProfileRecord | null,
    snapshot: UserRecommendationSnapshotRecord | null,
  ): SnapshotSelection | null {
    if (!profile || !snapshot) {
      return null;
    }

    if (!profile.qualified) {
      return null;
    }

    const personalizedFresh = this.isFresh(
      snapshot.generatedAt,
      PERSONALIZED_RECOMMENDATION_STALE_HOURS,
    );

    if (!personalizedFresh) {
      return null;
    }

    return {
      mode: "personalized",
      fallback: false,
      snapshot: {
        generatedAt: snapshot.generatedAt,
        candidates: snapshot.candidates,
      },
    };
  }

  private async selectPopularSnapshot(
    input: RecommendationQueryInput,
    fallbackReason?: RecommendationFallbackReason,
  ): Promise<SnapshotSelection> {
    const preferred = this.readPreferredPopularSegment(
      input.family,
      input.subtype,
    );
    const [preferredSnapshot, globalSnapshot] = await Promise.all([
      this.repository.getPopularSnapshot(
        preferred.segmentType,
        preferred.segmentValue,
      ),
      preferred.segmentType === "global"
        ? Promise.resolve<PopularRecommendationSnapshotRecord | null>(null)
        : this.repository.getPopularSnapshot("global", "global"),
    ]);

    const preferredIsFresh = preferredSnapshot
      ? this.isFresh(
          preferredSnapshot.generatedAt,
          POPULAR_RECOMMENDATION_STALE_HOURS,
        )
      : false;
    const globalIsFresh = globalSnapshot
      ? this.isFresh(
          globalSnapshot.generatedAt,
          POPULAR_RECOMMENDATION_STALE_HOURS,
        )
      : false;

    let selectedSnapshot: PopularRecommendationSnapshotRecord | null = null;

    if (preferredIsFresh && preferredSnapshot) {
      selectedSnapshot = preferredSnapshot;
    } else if (globalIsFresh && globalSnapshot) {
      selectedSnapshot = globalSnapshot;
    } else if (preferredSnapshot) {
      selectedSnapshot = preferredSnapshot;
    } else if (globalSnapshot) {
      selectedSnapshot = globalSnapshot;
    }

    if (!selectedSnapshot) {
      return {
        mode: "popular",
        fallback: Boolean(fallbackReason),
        fallbackReason,
        snapshot: {
          candidates: [],
        },
      };
    }

    return {
      mode: "popular",
      fallback: Boolean(fallbackReason),
      fallbackReason,
      snapshot: {
        generatedAt: selectedSnapshot.generatedAt,
        candidates: selectedSnapshot.candidates,
      },
    };
  }

  private readPersonalizedFallbackReason(
    profile: UserRecommendationProfileRecord | null,
    snapshot: UserRecommendationSnapshotRecord | null,
  ): RecommendationFallbackReason {
    if (profile && !profile.qualified) {
      return "unqualified_profile";
    }

    if (
      profile &&
      snapshot &&
      !this.isFresh(
        snapshot.generatedAt,
        PERSONALIZED_RECOMMENDATION_STALE_HOURS,
      )
    ) {
      return "stale_snapshot";
    }

    return "missing_snapshot";
  }

  private matchesFilters(
    posting: PublicPostingRecord,
    input: RecommendationQueryInput,
  ): boolean {
    if (input.family && posting.variant.family !== input.family) {
      return false;
    }

    if (input.subtype && posting.variant.subtype !== input.subtype) {
      return false;
    }

    if (input.geo?.radiusKm !== undefined) {
      const distanceKm = this.calculateDistanceKm(
        input.geo.latitude,
        input.geo.longitude,
        posting.location.latitude,
        posting.location.longitude,
      );

      if (distanceKm > input.geo.radiusKm) {
        return false;
      }
    }

    return true;
  }

  private readPreferredPopularSegment(
    family?: PostingFamily,
    subtype?: PostingSubtype,
  ) {
    if (family && subtype) {
      return {
        segmentType: "family_subtype" as const,
        segmentValue: `${family}:${subtype}`,
      };
    }

    if (family) {
      return {
        segmentType: "family" as const,
        segmentValue: family,
      };
    }

    return {
      segmentType: "global" as const,
      segmentValue: "global",
    };
  }

  private isFresh(generatedAt: string, staleHours: number): boolean {
    const generatedAtMs = new Date(generatedAt).getTime();
    const staleThresholdMs = staleHours * 60 * 60 * 1000;

    return Date.now() - generatedAtMs <= staleThresholdMs;
  }

  private createPagination(
    page: number,
    pageSize: number,
    total: number,
  ): PostingPagination {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  private calculateDistanceKm(
    startLatitude: number,
    startLongitude: number,
    endLatitude: number,
    endLongitude: number,
  ): number {
    const earthRadiusKm = 6371;
    const latitudeDelta = this.toRadians(endLatitude - startLatitude);
    const longitudeDelta = this.toRadians(endLongitude - startLongitude);
    const startLatitudeRadians = this.toRadians(startLatitude);
    const endLatitudeRadians = this.toRadians(endLatitude);

    const a =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(startLatitudeRadians) *
        Math.cos(endLatitudeRadians) *
        Math.sin(longitudeDelta / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusKm * c;
  }

  private toRadians(value: number): number {
    return (value * Math.PI) / 180;
  }
}
