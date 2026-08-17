import { createApplication } from "@/configuration/bootstrap/application";
import {
  getContainer,
  initializeContainer,
} from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import { environment, loadEnvironment } from "@/configuration/environment";
import { loggerFactory } from "@/configuration/logging";
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
  warmUsernameBloomFilter(): Promise<unknown>;
}

/**
 * Loads the username availability filter into this process before it serves
 * traffic.
 *
 * Deliberately non-fatal. The filter is an optimization over a database lookup
 * that still works, so a Redis problem here should cost speed rather than
 * boot — and an uninitialized filter reports `unknown` for every check, which
 * routes callers straight back to that lookup.
 */
async function warmUsernameBloomFilter(): Promise<void> {
  const logger = loggerFactory.forComponent("username-bloom", "app");

  try {
    await getContainer()
      .resolve(containerTokens.usernameBloomService)
      .initialize();
  } catch (error) {
    logger.warn(
      "Could not warm the username bloom filter; availability checks will query the database until it loads.",
      undefined,
      error,
    );
  }
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
  warmUsernameBloomFilter,
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
  await dependencies.warmUsernameBloomFilter();
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
