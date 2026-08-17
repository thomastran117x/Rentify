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
import { connectRedis, disconnectRedis } from "@/configuration/resources/redis";
import type { WorkerResource } from "@/workers/shared/worker-runtime";

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
