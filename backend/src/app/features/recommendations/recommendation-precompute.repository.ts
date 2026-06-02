import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  RecommendationActivityRow,
  RecommendationPopularSegmentRecord,
  RecommendationPopularSnapshotFreshnessRecord,
  RecommendationPostingCandidate,
  RecommendationRefreshJobRecord,
  RecommendationSignalCounts,
  UpsertPopularRecommendationSnapshotInput,
  UpsertUserRecommendationArtifactsInput,
} from "@/features/recommendations/recommendation-precompute.model";
import type {
  RecommendationPopularSegmentType,
  RecommendationRefreshJobType,
} from "@/features/recommendations/recommendation-activity.model";

type RefreshJobDelegate = {
  create: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  update: (args: unknown) => Promise<unknown>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
};

type UserRecommendationProfileDelegate = {
  upsert: (args: unknown) => Promise<unknown>;
};

type UserRecommendationSnapshotDelegate = {
  deleteMany: (args: unknown) => Promise<unknown>;
  upsert: (args: unknown) => Promise<unknown>;
};

type PopularRecommendationSnapshotDelegate = {
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  upsert: (args: unknown) => Promise<unknown>;
};

const SIGNAL_EVENT_TYPES = [
  "posting_view",
  "search_click",
  "booking_request_created",
  "renting_confirmed",
] as const;

export class RecommendationPrecomputeRepository extends BaseRepository {
  async claimRefreshJobBatch(
    limit: number,
  ): Promise<RecommendationRefreshJobRecord[]> {
    return this.executeAsync(async () => {
      const recommendationRefreshJob = (this.prisma as any)
        .recommendationRefreshJob as RefreshJobDelegate;
      const now = new Date();
      const staleProcessingThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const candidates = await recommendationRefreshJob.findMany({
        where: {
          processedAt: null,
          availableAt: {
            lte: now,
          },
          OR: [
            {
              processingAt: null,
            },
            {
              processingAt: {
                lt: staleProcessingThreshold,
              },
            },
          ],
        },
        orderBy: [
          {
            availableAt: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
        take: limit,
      });

      const claimed: RecommendationRefreshJobRecord[] = [];

      for (const candidate of candidates) {
        const result = await recommendationRefreshJob.updateMany({
          where: {
            id: candidate.id,
            processedAt: null,
            OR: [
              {
                processingAt: null,
              },
              {
                processingAt: {
                  lt: staleProcessingThreshold,
                },
              },
            ],
          },
          data: {
            processingAt: now,
          },
        });

        if (result.count === 1) {
          claimed.push(this.mapRefreshJob(candidate, now));
        }
      }

      return claimed;
    });
  }

  async markRefreshJobProcessed(id: string): Promise<void> {
    const recommendationRefreshJob = (this.prisma as any)
      .recommendationRefreshJob as RefreshJobDelegate;
    await this.executeAsync(() =>
      recommendationRefreshJob.update({
        where: {
          id,
        },
        data: {
          processedAt: new Date(),
          processingAt: null,
          lastError: null,
        },
      }),
    );
  }

  async markRefreshJobRetry(
    id: string,
    attempts: number,
    errorMessage: string,
  ): Promise<void> {
    const recommendationRefreshJob = (this.prisma as any)
      .recommendationRefreshJob as RefreshJobDelegate;
    const backoffSeconds = Math.min(300, 2 ** Math.min(attempts, 8));
    await this.executeAsync(() =>
      recommendationRefreshJob.update({
        where: {
          id,
        },
        data: {
          attempts: {
            increment: 1,
          },
          processingAt: null,
          availableAt: new Date(Date.now() + backoffSeconds * 1000),
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );
  }

  async listUserActivityRows(
    userId: string,
    windowStart: Date,
  ): Promise<RecommendationActivityRow[]> {
    const recommendationActivity = (this.prisma as any)
      .recommendationActivity as {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };

    return this.executeAsync(async () => {
      const rows = await recommendationActivity.findMany({
        where: {
          actorUserId: userId,
          personalizationEligible: true,
          lastOccurredAt: {
            gte: windowStart,
          },
          eventType: {
            in: [...SIGNAL_EVENT_TYPES],
          },
        },
        select: {
          postingId: true,
          eventType: true,
          count: true,
          lastOccurredAt: true,
          posting: {
            select: {
              family: true,
              subtype: true,
              tags: true,
            },
          },
        },
      });

      return rows.flatMap((row) => {
        const posting = row.posting as Record<string, unknown> | undefined;
        if (!posting) {
          return [];
        }

        return [
          {
            postingId: String(row.postingId),
            eventType: row.eventType as RecommendationActivityRow["eventType"],
            count: Number(row.count ?? 0),
            lastOccurredAt: new Date(row.lastOccurredAt as Date).toISOString(),
            family: posting.family as RecommendationActivityRow["family"],
            subtype: posting.subtype as RecommendationActivityRow["subtype"],
            tags: this.readTags(posting.tags),
          },
        ];
      });
    });
  }

  async listPopularActivityRows(
    windowStart: Date,
  ): Promise<RecommendationActivityRow[]> {
    const recommendationActivity = (this.prisma as any)
      .recommendationActivity as {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };

    return this.executeAsync(async () => {
      const rows = await recommendationActivity.findMany({
        where: {
          lastOccurredAt: {
            gte: windowStart,
          },
          eventType: {
            in: [...SIGNAL_EVENT_TYPES],
          },
        },
        select: {
          postingId: true,
          eventType: true,
          count: true,
          lastOccurredAt: true,
          posting: {
            select: {
              family: true,
              subtype: true,
              tags: true,
            },
          },
        },
      });

      return rows.flatMap((row) => {
        const posting = row.posting as Record<string, unknown> | undefined;
        if (!posting) {
          return [];
        }

        return [
          {
            postingId: String(row.postingId),
            eventType: row.eventType as RecommendationActivityRow["eventType"],
            count: Number(row.count ?? 0),
            lastOccurredAt: new Date(row.lastOccurredAt as Date).toISOString(),
            family: posting.family as RecommendationActivityRow["family"],
            subtype: posting.subtype as RecommendationActivityRow["subtype"],
            tags: this.readTags(posting.tags),
          },
        ];
      });
    });
  }

  async listPublishedRecommendationCandidates(input?: {
    excludeUserId?: string;
    family?: RecommendationPostingCandidate["family"];
    subtype?: RecommendationPostingCandidate["subtype"];
  }): Promise<RecommendationPostingCandidate[]> {
    const posting = (this.prisma as any).posting as {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };

    return this.executeAsync(async () => {
      const rows = await posting.findMany({
        where: {
          status: "published",
          ...(input?.excludeUserId
            ? {
                NOT: {
                  organization: {
                    memberships: {
                      some: {
                        userId: input.excludeUserId,
                      },
                    },
                  },
                },
              }
            : {}),
          ...(input?.family ? { family: input.family } : {}),
          ...(input?.subtype ? { subtype: input.subtype } : {}),
        },
        select: {
          id: true,
          organizationId: true,
          family: true,
          subtype: true,
          tags: true,
          availabilityStatus: true,
          publishedAt: true,
        },
      });

      return rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organizationId),
        family: row.family as RecommendationPostingCandidate["family"],
        subtype: row.subtype as RecommendationPostingCandidate["subtype"],
        tags: this.readTags(row.tags),
        availabilityStatus:
          row.availabilityStatus as RecommendationPostingCandidate["availabilityStatus"],
        publishedAt:
          row.publishedAt instanceof Date
            ? row.publishedAt.toISOString()
            : undefined,
      }));
    });
  }

  async listPublishedPopularSegments(): Promise<
    RecommendationPopularSegmentRecord[]
  > {
    const posting = (this.prisma as any).posting as {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };

    return this.executeAsync(async () => {
      const rows = await posting.findMany({
        where: {
          status: "published",
        },
        select: {
          family: true,
          subtype: true,
        },
        distinct: ["family", "subtype"],
      });

      const segments = new Map<string, RecommendationPopularSegmentRecord>();
      segments.set("global:global", {
        segmentType: "global",
        segmentValue: "global",
      });

      for (const row of rows) {
        const family =
          row.family as RecommendationPopularSegmentRecord["segmentValue"];
        const subtype =
          row.subtype as RecommendationPopularSegmentRecord["segmentValue"];

        segments.set(`family:${family}`, {
          segmentType: "family",
          segmentValue: family,
        });
        segments.set(`family_subtype:${family}:${subtype}`, {
          segmentType: "family_subtype",
          segmentValue: `${family}:${subtype}`,
        });
      }

      return [...segments.values()];
    });
  }

  async listPopularSnapshotFreshness(): Promise<
    RecommendationPopularSnapshotFreshnessRecord[]
  > {
    const popularRecommendationSnapshot = (this.prisma as any)
      .popularRecommendationSnapshot as PopularRecommendationSnapshotDelegate;

    return this.executeAsync(async () => {
      const rows = await popularRecommendationSnapshot.findMany({
        select: {
          segmentType: true,
          segmentValue: true,
          generatedAt: true,
        },
      });

      return rows.map((row) => ({
        segmentType: row.segmentType as RecommendationPopularSegmentType,
        segmentValue: String(row.segmentValue),
        generatedAt: new Date(row.generatedAt as Date).toISOString(),
      }));
    });
  }

  async enqueueRefreshJobs(
    jobs: Array<{
      jobType: RecommendationRefreshJobType;
      dedupeKey: string;
      userId?: string;
      segmentType?: RecommendationPopularSegmentType;
      segmentValue?: string;
      availableAt: Date;
    }>,
  ): Promise<void> {
    await this.executeAsync(async () => {
      const recommendationRefreshJob = (this.prisma as any)
        .recommendationRefreshJob as RefreshJobDelegate;

      for (const job of jobs) {
        await this.upsertRefreshJob(recommendationRefreshJob, job);
      }
    });
  }

  async upsertUserRecommendationArtifacts(
    input: UpsertUserRecommendationArtifactsInput,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const recommendationProfile = (transaction as any)
          .userRecommendationProfile as UserRecommendationProfileDelegate;
        const recommendationSnapshot = (transaction as any)
          .userRecommendationSnapshot as UserRecommendationSnapshotDelegate;

        await recommendationProfile.upsert({
          where: {
            userId: input.profile.userId,
          },
          update: {
            qualified: input.profile.qualified,
            activityWindowStartAt: new Date(
              input.profile.activityWindowStartAt,
            ),
            lastSignalAt: input.profile.lastSignalAt
              ? new Date(input.profile.lastSignalAt)
              : null,
            distinctPostingCount: input.profile.distinctPostingCount,
            signalCounts: input.profile
              .signalCounts as unknown as Prisma.InputJsonValue,
            familyAffinities: input.profile
              .familyAffinities as unknown as Prisma.InputJsonValue,
            subtypeAffinities: input.profile
              .subtypeAffinities as unknown as Prisma.InputJsonValue,
            tagAffinities: input.profile
              .tagAffinities as unknown as Prisma.InputJsonValue,
            rebuiltAt: new Date(input.profile.rebuiltAt),
          },
          create: {
            id: randomUUID(),
            userId: input.profile.userId,
            qualified: input.profile.qualified,
            activityWindowStartAt: new Date(
              input.profile.activityWindowStartAt,
            ),
            lastSignalAt: input.profile.lastSignalAt
              ? new Date(input.profile.lastSignalAt)
              : null,
            distinctPostingCount: input.profile.distinctPostingCount,
            signalCounts: input.profile
              .signalCounts as unknown as Prisma.InputJsonValue,
            familyAffinities: input.profile
              .familyAffinities as unknown as Prisma.InputJsonValue,
            subtypeAffinities: input.profile
              .subtypeAffinities as unknown as Prisma.InputJsonValue,
            tagAffinities: input.profile
              .tagAffinities as unknown as Prisma.InputJsonValue,
            rebuiltAt: new Date(input.profile.rebuiltAt),
          },
        });

        if (!input.snapshot) {
          await recommendationSnapshot.deleteMany({
            where: {
              userId: input.profile.userId,
            },
          });
          return;
        }

        await recommendationSnapshot.upsert({
          where: {
            userId: input.snapshot.userId,
          },
          update: {
            generatedAt: new Date(input.snapshot.generatedAt),
            sourceLastSignalAt: input.snapshot.sourceLastSignalAt
              ? new Date(input.snapshot.sourceLastSignalAt)
              : null,
            candidateCount: input.snapshot.candidateCount,
            candidates: input.snapshot
              .candidates as unknown as Prisma.InputJsonValue,
          },
          create: {
            id: randomUUID(),
            userId: input.snapshot.userId,
            generatedAt: new Date(input.snapshot.generatedAt),
            sourceLastSignalAt: input.snapshot.sourceLastSignalAt
              ? new Date(input.snapshot.sourceLastSignalAt)
              : null,
            candidateCount: input.snapshot.candidateCount,
            candidates: input.snapshot
              .candidates as unknown as Prisma.InputJsonValue,
          },
        });
      }),
    );
  }

  async upsertPopularRecommendationSnapshot(
    input: UpsertPopularRecommendationSnapshotInput,
  ): Promise<void> {
    const popularRecommendationSnapshot = (this.prisma as any)
      .popularRecommendationSnapshot as PopularRecommendationSnapshotDelegate;

    await this.executeAsync(() =>
      popularRecommendationSnapshot.upsert({
        where: {
          segmentType_segmentValue: {
            segmentType: input.segmentType,
            segmentValue: input.segmentValue,
          },
        },
        update: {
          generatedAt: new Date(input.generatedAt),
          sourceLastSignalAt: input.sourceLastSignalAt
            ? new Date(input.sourceLastSignalAt)
            : null,
          candidateCount: input.candidateCount,
          candidates: input.candidates as unknown as Prisma.InputJsonValue,
        },
        create: {
          id: randomUUID(),
          segmentType: input.segmentType,
          segmentValue: input.segmentValue,
          generatedAt: new Date(input.generatedAt),
          sourceLastSignalAt: input.sourceLastSignalAt
            ? new Date(input.sourceLastSignalAt)
            : null,
          candidateCount: input.candidateCount,
          candidates: input.candidates as unknown as Prisma.InputJsonValue,
        },
      }),
    );
  }

  createEmptySignalCounts(): RecommendationSignalCounts {
    return {
      posting_view: 0,
      search_click: 0,
      booking_request_created: 0,
      renting_confirmed: 0,
    };
  }

  private async upsertRefreshJob(
    recommendationRefreshJob: RefreshJobDelegate,
    job: {
      jobType: RecommendationRefreshJobType;
      dedupeKey: string;
      userId?: string;
      segmentType?: RecommendationPopularSegmentType;
      segmentValue?: string;
      availableAt: Date;
    },
  ): Promise<void> {
    const existing = await recommendationRefreshJob.findUnique({
      where: {
        dedupeKey: job.dedupeKey,
      },
    });

    if (!existing) {
      await recommendationRefreshJob.create({
        data: {
          id: randomUUID(),
          jobType: job.jobType,
          dedupeKey: job.dedupeKey,
          userId: job.userId ?? null,
          segmentType: job.segmentType ?? null,
          segmentValue: job.segmentValue ?? null,
          availableAt: job.availableAt,
        },
      });
      return;
    }

    const existingProcessedAt = existing.processedAt as Date | null | undefined;
    const existingProcessingAt = existing.processingAt as
      | Date
      | null
      | undefined;
    const existingAvailableAt = existing.availableAt as Date | null | undefined;

    if (!existingProcessedAt) {
      const nextAvailableAt =
        existingAvailableAt &&
        existingAvailableAt.getTime() < job.availableAt.getTime()
          ? existingAvailableAt
          : job.availableAt;

      await recommendationRefreshJob.update({
        where: {
          dedupeKey: job.dedupeKey,
        },
        data: {
          availableAt: nextAvailableAt,
          ...(existingProcessingAt
            ? {}
            : {
                lastError: null,
              }),
        },
      });
      return;
    }

    await recommendationRefreshJob.update({
      where: {
        dedupeKey: job.dedupeKey,
      },
      data: {
        jobType: job.jobType,
        userId: job.userId ?? null,
        segmentType: job.segmentType ?? null,
        segmentValue: job.segmentValue ?? null,
        availableAt: job.availableAt,
        processingAt: null,
        processedAt: null,
        attempts: 0,
        lastError: null,
      },
    });
  }

  private mapRefreshJob(
    job: Record<string, unknown>,
    processingAt?: Date,
  ): RecommendationRefreshJobRecord {
    return {
      id: String(job.id),
      jobType: job.jobType as RecommendationRefreshJobType,
      userId: typeof job.userId === "string" ? job.userId : undefined,
      segmentType:
        typeof job.segmentType === "string"
          ? (job.segmentType as RecommendationPopularSegmentType)
          : undefined,
      segmentValue:
        typeof job.segmentValue === "string" ? job.segmentValue : undefined,
      attempts: Number(job.attempts ?? 0),
      availableAt: new Date(job.availableAt as Date).toISOString(),
      createdAt: new Date(job.createdAt as Date).toISOString(),
      updatedAt: (
        processingAt ?? new Date(job.updatedAt as Date)
      ).toISOString(),
    };
  }

  private readTags(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  }
}
