import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import type {
  ProcessBookingApprovedEventInput,
  ProcessBookingCancelledEventInput,
  ProcessBookingDeclinedEventInput,
  ProcessBookingExpiredEventInput,
  ProcessBookingRequestedEventInput,
  ProcessPaymentFailedEventInput,
  ProcessRentingConfirmedEventInput,
  ProcessPostingViewedEventInput,
  ProcessRefundRecordedEventInput,
  ProcessSearchClickEventInput,
  ProcessSearchImpressionEventInput,
} from "@/features/postings/analytics/analytics.model";
import {
  databaseWorkerResource,
  disconnectResources,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Postings analytics worker";
const workerResources = [databaseWorkerResource];
const workerLogger = loggerFactory
  .forComponent("postings-analytics.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapPostingsAnalyticsWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getAnalyticsWorkerConfig().pollIntervalMs,
    runOnce: async ({ scope }) => {
      const repository = scope.resolve(
        containerTokens.postingsAnalyticsRepository,
      );
      const { batchSize } = environment.getAnalyticsWorkerConfig();
      const jobs = await repository.claimOutboxBatch(batchSize);

      for (const job of jobs) {
        try {
          if (job.eventType === "posting_viewed") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessPostingViewedEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
              viewerHash: readString(payload.viewerHash, "viewerHash"),
              userId: readOptionalString(payload.userId),
              ipAddressHash: readOptionalString(payload.ipAddressHash),
              userAgentHash: readOptionalString(payload.userAgentHash),
              deviceType: readString(payload.deviceType, "deviceType"),
            };

            await repository.processPostingViewedEvent(input);
          }

          if (job.eventType === "booking_requested") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessBookingRequestedEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
              estimatedTotal: readOptionalNumber(payload.estimatedTotal) ?? 0,
            };

            await repository.processBookingRequestedEvent(input);
          }

          if (job.eventType === "search_impression") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessSearchImpressionEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
            };

            await repository.processSearchImpressionEvent(input);
          }

          if (job.eventType === "search_click") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessSearchClickEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
            };

            await repository.processSearchClickEvent(input);
          }

          if (job.eventType === "booking_approved") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessBookingApprovedEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
            };

            await repository.processBookingApprovedEvent(input);
          }

          if (job.eventType === "booking_declined") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessBookingDeclinedEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
            };

            await repository.processBookingDeclinedEvent(input);
          }

          if (job.eventType === "booking_expired") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessBookingExpiredEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
            };

            await repository.processBookingExpiredEvent(input);
          }

          if (job.eventType === "booking_cancelled") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessBookingCancelledEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
            };

            await repository.processBookingCancelledEvent(input);
          }

          if (job.eventType === "payment_failed") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessPaymentFailedEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
            };

            await repository.processPaymentFailedEvent(input);
          }

          if (job.eventType === "refund_recorded") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessRefundRecordedEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
              refundedAmount: readOptionalNumber(payload.refundedAmount) ?? 0,
            };

            await repository.processRefundRecordedEvent(input);
          }

          if (job.eventType === "renting_confirmed") {
            const payload = job.payload as Record<string, unknown>;
            const occurredAt = readString(payload.occurredAt, "occurredAt");
            const input: ProcessRentingConfirmedEventInput = {
              postingId: job.postingId,
              organizationId: job.organizationId,
              occurredAt,
              eventDate: floorToUtcDay(occurredAt),
              eventHour: floorToUtcHour(occurredAt),
              estimatedTotal: readOptionalNumber(payload.estimatedTotal) ?? 0,
            };

            await repository.processRentingConfirmedEvent(input);
          }

          await repository.markOutboxProcessed(job.id);
        } catch (error) {
          workerLogger.error(
            "Failed to process postings analytics outbox job.",
            {
              jobId: job.id,
              postingId: job.postingId,
              eventType: job.eventType,
            },
            error,
          );
          await repository.markOutboxRetry(
            job.id,
            job.attempts + 1,
            error instanceof Error ? error.message : "Unknown analytics error.",
          );
        }
      }

      return jobs.length;
    },
  });
}

function floorToUtcDay(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function floorToUtcHour(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Analytics payload field ${fieldName} is required.`);
  }

  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

startWorker({
  name: workerName,
  bootstrap: bootstrapPostingsAnalyticsWorker,
  cleanup: () => disconnectResources(workerResources),
});
