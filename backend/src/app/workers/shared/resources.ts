import {
  connectDatabase,
  disconnectDatabase,
} from "@/configuration/resources/database";
import {
  connectElasticsearch,
  disconnectElasticsearch,
} from "@/configuration/resources/elasticsearch";
import {
  connectRabbitMq,
  disconnectRabbitMq,
} from "@/configuration/resources/rabbitmq";
import { loggerFactory } from "@/configuration/logging";
import { connectRedis, disconnectRedis } from "@/configuration/resources/redis";
import { checkBlobStorageAccess } from "@/features/blob/blob-storage-access";
import { checkImageModerationAccess } from "@/features/media/moderation/check-image-moderation";
import type { WorkerResource } from "@/workers/shared/worker-runtime";

const resourcesLogger = loggerFactory.forComponent(
  "worker-resources",
  "worker",
);

/**
 * For workers that touch blobs; list it first, so a worker that cannot reach
 * blob storage stops before connecting to anything else.
 */
export const blobStorageWorkerResource: WorkerResource = {
  connect: () => checkBlobStorageAccess(),
  disconnect: async () => undefined,
};

/**
 * For the media processing worker: refuses to start on invalid moderation
 * settings, or a provider that refuses the worker, before it takes any job.
 */
export const imageModerationWorkerResource: WorkerResource = {
  connect: () => checkImageModerationAccess(),
  disconnect: async () => undefined,
};

export const databaseWorkerResource: WorkerResource = {
  connect: connectDatabase,
  disconnect: disconnectDatabase,
};

export const elasticsearchWorkerResource: WorkerResource = {
  connect: connectElasticsearch,
  disconnect: disconnectElasticsearch,
};

export const rabbitMqWorkerResource: WorkerResource = {
  connect: connectRabbitMq,
  disconnect: disconnectRabbitMq,
};

export const redisWorkerResource: WorkerResource = {
  connect: connectRedis,
  disconnect: disconnectRedis,
};

/**
 * Redis for a worker that uses it only for best-effort work, such as the media
 * processing worker's status pushes. The worker starts without waiting for it:
 * the client connects, and reconnects after an outage, in the background, and
 * the work that needs it is skipped while it is not ready. A Redis outage must
 * not stop images from being processed.
 */
export const optionalRedisWorkerResource: WorkerResource = {
  connect: async () => {
    void connectRedis().catch((error: unknown) => {
      resourcesLogger.warn(
        "Redis is unavailable; continuing without it.",
        undefined,
        error,
      );
    });
  },
  disconnect: disconnectRedis,
};

export const searchBrokerWorkerResources = [
  databaseWorkerResource,
  elasticsearchWorkerResource,
  rabbitMqWorkerResource,
];

export async function disconnectResources(
  resources: WorkerResource[],
): Promise<void> {
  await Promise.allSettled(resources.map((resource) => resource.disconnect()));
}
