import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import {
  databaseWorkerResource,
  disconnectResources,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Booking request expiry worker";
const workerResources = [databaseWorkerResource];
const workerLogger = loggerFactory
  .forComponent("booking-expiry.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapBookingExpiryWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getBookingExpiryWorkerConfig().pollIntervalMs,
    runOnce: async ({ scope }) => {
      const repository = scope.resolve(containerTokens.bookingsRepository);
      const postingsAnalyticsRepository = scope.resolve(
        containerTokens.postingsAnalyticsRepository,
      );
      const postingsRepository = scope.resolve(
        containerTokens.postingsRepository,
      );
      const postingsPublicCacheService = scope.resolve(
        containerTokens.postingsPublicCacheService,
      );
      const { batchSize } = environment.getBookingExpiryWorkerConfig();
      const jobs = await repository.listExpiredCandidates(batchSize);

      for (const job of jobs) {
        try {
          const expired = await repository.expire(job.id);

          if (expired) {
            await postingsAnalyticsRepository.enqueueBookingExpiredEvent({
              postingId: job.postingId,
              ownerId: job.ownerId,
              occurredAt: new Date().toISOString(),
            });
            await invalidatePublicPostingProjection(
              postingsPublicCacheService,
              job.postingId,
            );
            await postingsRepository.enqueueSearchSync(job.postingId);
          }
        } catch (error) {
          workerLogger.error(
            "Failed to expire booking request hold.",
            {
              bookingRequestId: job.id,
              postingId: job.postingId,
              status: job.status,
            },
            error,
          );
        }
      }

      return jobs.length;
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapBookingExpiryWorker,
  cleanup: () => disconnectResources(workerResources),
});
