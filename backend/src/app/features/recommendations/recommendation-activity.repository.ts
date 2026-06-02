import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  PersistRecommendationActivityInput,
  RecommendationPostingSummary,
  UpsertRecommendationRefreshJobInput,
} from "@/features/recommendations/recommendation-activity.model";

export class RecommendationActivityRepository extends BaseRepository {
  async findPostingSummary(
    postingId: string,
  ): Promise<RecommendationPostingSummary | null> {
    const prismaPosting = this.prisma.posting as unknown as {
      findUnique: (args: unknown) => Promise<{
        id: string;
        organizationId: string;
        family: RecommendationPostingSummary["family"];
        subtype: RecommendationPostingSummary["subtype"];
      } | null>;
    };
    const posting = await this.executeAsync(() =>
      prismaPosting.findUnique({
        where: {
          id: postingId,
        },
        select: {
          id: true,
          organizationId: true,
          family: true,
          subtype: true,
        },
      }),
    );

    if (!posting) {
      return null;
    }

    return {
      id: posting.id,
      organizationId: posting.organizationId,
      family: posting.family,
      subtype: posting.subtype,
    };
  }

  async persistActivityAndRefreshJobs(
    activity: PersistRecommendationActivityInput,
    jobs: UpsertRecommendationRefreshJobInput[],
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const recommendationActivity = (transaction as any)
          .recommendationActivity as {
          upsert: (args: unknown) => Promise<unknown>;
        };
        const recommendationRefreshJob = (transaction as any)
          .recommendationRefreshJob as {
          create: (args: unknown) => Promise<unknown>;
          findUnique: (
            args: unknown,
          ) => Promise<Record<string, unknown> | null>;
          update: (args: unknown) => Promise<unknown>;
        };

        if (activity.coalesced) {
          await recommendationActivity.upsert({
            where: {
              aggregationKey: activity.aggregationKey,
            },
            update: {
              occurredAt: activity.occurredAt,
              count: {
                increment: 1,
              },
              lastOccurredAt: activity.lastOccurredAt,
              requestId: activity.requestId ?? null,
              searchSessionId: activity.searchSessionId ?? null,
              metadata: (activity.metadata ??
                null) as Prisma.InputJsonValue | null,
              personalizationEligible: activity.personalizationEligible,
            },
            create: {
              id: activity.id,
              aggregationKey: activity.aggregationKey,
              eventType: activity.eventType,
              source: activity.source,
              occurredAt: activity.occurredAt,
              postingId: activity.postingId,
              organizationId: activity.organizationId,
              actorUserId: activity.actorUserId ?? null,
              anonymousActorHash: activity.anonymousActorHash ?? null,
              deviceType: activity.deviceType,
              requestId: activity.requestId ?? null,
              searchSessionId: activity.searchSessionId ?? null,
              metadata: (activity.metadata ??
                null) as Prisma.InputJsonValue | null,
              count: activity.count,
              firstOccurredAt: activity.firstOccurredAt,
              lastOccurredAt: activity.lastOccurredAt,
              personalizationEligible: activity.personalizationEligible,
            },
          });
        } else {
          await recommendationActivity.upsert({
            where: {
              aggregationKey: activity.aggregationKey,
            },
            update: {
              occurredAt: activity.occurredAt,
              requestId: activity.requestId ?? null,
              searchSessionId: activity.searchSessionId ?? null,
              metadata: (activity.metadata ??
                null) as Prisma.InputJsonValue | null,
              personalizationEligible: activity.personalizationEligible,
            },
            create: {
              id: activity.id,
              aggregationKey: activity.aggregationKey,
              eventType: activity.eventType,
              source: activity.source,
              occurredAt: activity.occurredAt,
              postingId: activity.postingId,
              organizationId: activity.organizationId,
              actorUserId: activity.actorUserId ?? null,
              anonymousActorHash: activity.anonymousActorHash ?? null,
              deviceType: activity.deviceType,
              requestId: activity.requestId ?? null,
              searchSessionId: activity.searchSessionId ?? null,
              metadata: (activity.metadata ??
                null) as Prisma.InputJsonValue | null,
              count: activity.count,
              firstOccurredAt: activity.firstOccurredAt,
              lastOccurredAt: activity.lastOccurredAt,
              personalizationEligible: activity.personalizationEligible,
            },
          });
        }

        for (const job of jobs) {
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
            continue;
          }

          const existingProcessedAt = existing.processedAt as
            | Date
            | null
            | undefined;
          const existingAvailableAt = existing.availableAt as
            | Date
            | null
            | undefined;

          if (!existingProcessedAt) {
            await recommendationRefreshJob.update({
              where: {
                dedupeKey: job.dedupeKey,
              },
              data: {
                availableAt:
                  existingAvailableAt &&
                  existingAvailableAt.getTime() < job.availableAt.getTime()
                    ? existingAvailableAt
                    : job.availableAt,
                lastError: null,
              },
            });
            continue;
          }

          await recommendationRefreshJob.update({
            where: {
              dedupeKey: job.dedupeKey,
            },
            data: {
              availableAt: job.availableAt,
              processingAt: null,
              processedAt: null,
              attempts: 0,
              lastError: null,
            },
          });
        }
      }),
    );
  }
}
