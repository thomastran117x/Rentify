import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type { BookingRequestStatus } from "@/features/bookings/bookings.model";
import type {
  PopularRecommendationSnapshotRecord,
  RecommendationCandidateRecord,
  UserRecommendationProfileRecord,
  UserRecommendationSnapshotRecord,
} from "@/features/recommendations/recommendation-precompute.model";
import type { RecommendationPopularSegmentType } from "@/features/recommendations/recommendation-activity.model";

interface RecommendationPersonalizationContextRecord {
  recommendationPersonalizationEnabled: boolean;
  profile: UserRecommendationProfileRecord | null;
  snapshot: UserRecommendationSnapshotRecord | null;
}

export interface RecommendationAvailabilityWindowInput {
  candidateIds: string[];
  startAt: Date;
  endAt: Date;
}

type JsonObject = Record<string, unknown>;

export class RecommendationQueryRepository extends BaseRepository {
  async getPersonalizationContext(
    userId: string,
  ): Promise<RecommendationPersonalizationContextRecord> {
    return this.executeAsync(async () => {
      const [profileSettings, profile, snapshot] = await Promise.all([
        (
          this.prisma.profile as unknown as {
            findUnique: (args: unknown) => Promise<{
              recommendationPersonalizationEnabled?: boolean | null;
            } | null>;
          }
        ).findUnique({
          where: {
            userId,
          },
          select: {
            recommendationPersonalizationEnabled: true,
          },
        }),
        (this.prisma as any).userRecommendationProfile.findUnique({
          where: {
            userId,
          },
        }) as Promise<Record<string, unknown> | null>,
        (this.prisma as any).userRecommendationSnapshot.findUnique({
          where: {
            userId,
          },
        }) as Promise<Record<string, unknown> | null>,
      ]);

      return {
        recommendationPersonalizationEnabled:
          profileSettings?.recommendationPersonalizationEnabled ?? true,
        profile: profile ? this.mapUserRecommendationProfile(profile) : null,
        snapshot: snapshot
          ? this.mapUserRecommendationSnapshot(snapshot)
          : null,
      };
    });
  }

  async getPopularSnapshot(
    segmentType: RecommendationPopularSegmentType,
    segmentValue: string,
  ): Promise<PopularRecommendationSnapshotRecord | null> {
    const snapshot = await this.executeAsync(() =>
      (
        (this.prisma as any).popularRecommendationSnapshot as {
          findUnique: (
            args: unknown,
          ) => Promise<Record<string, unknown> | null>;
        }
      ).findUnique({
        where: {
          segmentType_segmentValue: {
            segmentType,
            segmentValue,
          },
        },
      }),
    );

    return snapshot ? this.mapPopularRecommendationSnapshot(snapshot) : null;
  }

  async listExcludedPostingIdsForUser(userId: string): Promise<Set<string>> {
    return this.executeAsync(async () => {
      const activeBookingStatuses: BookingRequestStatus[] = [
        "pending",
        "awaiting_payment",
        "payment_processing",
        "payment_failed",
        "paid",
      ];
      const [ownedPostings, activeBookingRequests, confirmedRentings] =
        await Promise.all([
          this.prisma.posting.findMany({
            where: {
              organization: {
                memberships: {
                  some: {
                    userId,
                  },
                },
              },
              status: "published",
              archivedAt: null,
            },
            select: {
              id: true,
            },
          }),
          this.prisma.bookingRequest.findMany({
            where: {
              renterId: userId,
              status: {
                in: activeBookingStatuses,
              },
              convertedAt: null,
            },
            select: {
              postingId: true,
            },
            distinct: ["postingId"],
          }),
          this.prisma.renting.findMany({
            where: {
              renterId: userId,
              status: "confirmed",
            },
            select: {
              postingId: true,
            },
            distinct: ["postingId"],
          }),
        ]);

      return new Set([
        ...ownedPostings.map((posting) => posting.id),
        ...activeBookingRequests.map((request) => request.postingId),
        ...confirmedRentings.map((renting) => renting.postingId),
      ]);
    });
  }

  async filterCandidateIdsByAvailabilityWindow(
    input: RecommendationAvailabilityWindowInput,
  ): Promise<string[]> {
    if (input.candidateIds.length === 0) {
      return [];
    }

    return this.executeAsync(async () => {
      const now = new Date();
      const idsSql = Prisma.join(input.candidateIds);
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string }>
      >(Prisma.sql`
        SELECT postings.id
        FROM postings
        WHERE postings.id IN (${idsSql})
          AND postings.status = 'published'
          AND postings.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM posting_availability_blocks pab
            LEFT JOIN booking_requests br
              ON br.hold_block_id = pab.id
            WHERE pab.posting_id = postings.id
              AND pab.start_at < ${input.endAt}
              AND pab.end_at > ${input.startAt}
              AND (
                br.id IS NULL
                OR (
                  br.status IN ('awaiting_payment', 'payment_processing', 'paid')
                  AND br.converted_at IS NULL
                  AND br.hold_expires_at > ${now}
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM booking_requests br
            WHERE br.posting_id = postings.id
              AND br.status IN ('pending', 'awaiting_payment', 'payment_processing', 'paid')
              AND br.converted_at IS NULL
              AND (
                br.conversion_reservation_expires_at IS NULL
                OR br.conversion_reservation_expires_at <= ${now}
              )
              AND br.hold_expires_at > ${now}
              AND br.start_at < ${input.endAt}
              AND br.end_at > ${input.startAt}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM rentings r
            WHERE r.posting_id = postings.id
              AND r.start_at < ${input.endAt}
              AND r.end_at > ${input.startAt}
          )
      `);

      const eligibleIds = new Set(rows.map((row) => row.id));
      return input.candidateIds.filter((id) => eligibleIds.has(id));
    });
  }

  private mapUserRecommendationProfile(
    record: Record<string, unknown>,
  ): UserRecommendationProfileRecord {
    return {
      userId: String(record.userId),
      qualified: Boolean(record.qualified),
      activityWindowStartAt: this.toIsoString(record.activityWindowStartAt),
      lastSignalAt: this.toOptionalIsoString(record.lastSignalAt),
      distinctPostingCount: Number(record.distinctPostingCount ?? 0),
      signalCounts: this.readSignalCounts(record.signalCounts),
      familyAffinities: this.readAffinityScores(record.familyAffinities),
      subtypeAffinities: this.readAffinityScores(record.subtypeAffinities),
      tagAffinities: this.readAffinityScores(record.tagAffinities),
      rebuiltAt: this.toIsoString(record.rebuiltAt),
    };
  }

  private mapUserRecommendationSnapshot(
    record: Record<string, unknown>,
  ): UserRecommendationSnapshotRecord {
    return {
      userId: String(record.userId),
      generatedAt: this.toIsoString(record.generatedAt),
      sourceLastSignalAt: this.toOptionalIsoString(record.sourceLastSignalAt),
      candidateCount: Number(record.candidateCount ?? 0),
      candidates: this.readCandidates(record.candidates),
    };
  }

  private mapPopularRecommendationSnapshot(
    record: Record<string, unknown>,
  ): PopularRecommendationSnapshotRecord {
    return {
      segmentType: record.segmentType as RecommendationPopularSegmentType,
      segmentValue: String(record.segmentValue),
      generatedAt: this.toIsoString(record.generatedAt),
      sourceLastSignalAt: this.toOptionalIsoString(record.sourceLastSignalAt),
      candidateCount: Number(record.candidateCount ?? 0),
      candidates: this.readCandidates(record.candidates),
    };
  }

  private readCandidates(value: unknown): RecommendationCandidateRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter(
        (entry): entry is JsonObject =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry) => ({
        postingId: String(entry.postingId ?? ""),
        score:
          typeof entry.score === "number"
            ? entry.score
            : Number(entry.score ?? 0),
        reasonCodes: Array.isArray(entry.reasonCodes)
          ? entry.reasonCodes.filter(
              (
                code,
              ): code is RecommendationCandidateRecord["reasonCodes"][number] =>
                typeof code === "string",
            )
          : [],
      }))
      .filter((entry) => entry.postingId.length > 0);
  }

  private readAffinityScores(
    value: unknown,
  ): UserRecommendationProfileRecord["familyAffinities"] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter(
        (entry): entry is JsonObject =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry) => ({
        value: String(entry.value ?? ""),
        score:
          typeof entry.score === "number"
            ? entry.score
            : Number(entry.score ?? 0),
      }))
      .filter((entry) => entry.value.length > 0);
  }

  private readSignalCounts(
    value: unknown,
  ): UserRecommendationProfileRecord["signalCounts"] {
    const objectValue =
      typeof value === "object" && value !== null ? (value as JsonObject) : {};

    return {
      posting_view: Number(objectValue.posting_view ?? 0),
      search_click: Number(objectValue.search_click ?? 0),
      booking_request_created: Number(objectValue.booking_request_created ?? 0),
      renting_confirmed: Number(objectValue.renting_confirmed ?? 0),
    };
  }

  private toIsoString(value: unknown): string {
    return value instanceof Date
      ? value.toISOString()
      : new Date(String(value)).toISOString();
  }

  private toOptionalIsoString(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }

    return this.toIsoString(value);
  }
}
