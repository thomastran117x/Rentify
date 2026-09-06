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
  warmIdentityBloomFilters(): Promise<unknown>;
}

/**
 * Loads the username and email availability filters into this process before
 * it serves traffic.
 *
 * Deliberately non-fatal, and per filter: each is an optimization over a
 * database lookup that still works, so a Redis problem here should cost speed
 * rather than boot — and an uninitialized filter reports `unknown` for every
 * check, which routes callers straight back to that lookup. Warming them
 * independently means one failing does not leave the other cold.
 */
async function warmIdentityBloomFilters(): Promise<void> {
  const logger = loggerFactory.forComponent("identity-bloom", "app");
  const filters = [
    { subject: "username", token: containerTokens.usernameBloomService },
    { subject: "email", token: containerTokens.emailBloomService },
  ] as const;

  for (const { subject, token } of filters) {
    try {
      await getContainer().resolve(token).initialize();
    } catch (error) {
      logger.warn(
        `Could not warm the ${subject} bloom filter; availability checks will query the database until it loads.`,
        { subject },
        error,
      );
    }
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
  warmIdentityBloomFilters,
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
  await dependencies.warmIdentityBloomFilters();
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
