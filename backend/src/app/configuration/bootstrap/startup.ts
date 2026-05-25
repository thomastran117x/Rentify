import { createApplication } from "@/configuration/bootstrap/application";
import { initializeContainer } from "@/configuration/bootstrap/container";
import { environment, loadEnvironment } from "@/configuration/environment";
import {
  connectElasticsearch,
  disconnectElasticsearch,
} from "@/configuration/resources/elasticsearch";
import {
  connectDatabase,
  disconnectDatabase,
} from "@/configuration/resources/database";
import { connectRedis, disconnectRedis } from "@/configuration/resources/redis";
import {
  connectRabbitMq,
  disconnectRabbitMq,
  isRabbitMqEnabled,
} from "@/configuration/resources/rabbitmq";
import { runAutoSeedsIfNeeded } from "@/seeds/orchestrator";

export interface StartupDependencies {
  connectDatabase(): Promise<unknown>;
  connectElasticsearch(): Promise<unknown>;
  connectRedis(): Promise<unknown>;
  connectRabbitMq(): Promise<unknown>;
  createApplication(): ReturnType<typeof createApplication>;
  initializeContainer(): ReturnType<typeof initializeContainer>;
  isRabbitMqEnabled(): boolean;
  loadEnvironment(): ReturnType<typeof loadEnvironment>;
  runAutoSeedsIfNeeded(): Promise<unknown>;
}

const defaultDependencies: StartupDependencies = {
  connectDatabase,
  connectElasticsearch,
  connectRedis,
  connectRabbitMq,
  createApplication,
  initializeContainer,
  isRabbitMqEnabled,
  loadEnvironment,
  runAutoSeedsIfNeeded,
};

export async function initializeServerApplication(
  overrides: Partial<StartupDependencies> = {},
): Promise<{
  app: ReturnType<typeof createApplication>;
  port: number;
}> {
  const dependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  dependencies.loadEnvironment();
  const port = environment.getServerPort();

  await dependencies.connectDatabase();
  await dependencies.runAutoSeedsIfNeeded();
  await dependencies.connectRedis();
  await dependencies.connectElasticsearch();
  if (dependencies.isRabbitMqEnabled()) {
    await dependencies.connectRabbitMq();
  }

  dependencies.initializeContainer();
  const app = dependencies.createApplication();

  return {
    app,
    port,
  };
}

export async function disconnectApplicationResources(): Promise<void> {
  await Promise.allSettled([
    disconnectRabbitMq(),
    disconnectRedis(),
    disconnectDatabase(),
    disconnectElasticsearch(),
  ]);
}
