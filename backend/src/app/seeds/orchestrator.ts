import { environment } from "@/configuration/environment";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { getDatabaseClient } from "@/configuration/resources/database";
import { activitySeedModule } from "@/seeds/modules/activity.module";
import { bookingsSeedModule } from "@/seeds/modules/bookings.module";
import { postingsSeedModule } from "@/seeds/modules/postings.module";
import { usersSeedModule } from "@/seeds/modules/users.module";
import { resolveAutoSeedPolicy } from "@/seeds/policy";
import type {
  RunSeedOrchestratorOptions,
  SeedLogger,
  SeedModule,
  SeedSummary,
} from "@/seeds/types";

const seedRuntimeLogger = loggerFactory.forComponent(
  "seed-orchestrator",
  "seed",
);

function createSeedLoggerAdapter(sourceLogger: Logger): SeedLogger {
  return {
    info(message: string) {
      sourceLogger.info(message);
    },
    warn(message: string) {
      sourceLogger.warn(message);
    },
  };
}

const defaultLogger: SeedLogger = createSeedLoggerAdapter(seedRuntimeLogger);

export const defaultSeedModules: SeedModule[] = [
  usersSeedModule,
  postingsSeedModule,
  bookingsSeedModule,
  activitySeedModule,
];

export async function runSeedOrchestrator(
  options: RunSeedOrchestratorOptions = {},
): Promise<SeedSummary> {
  const prisma = options.prisma ?? getDatabaseClient();
  const logger = options.logger ?? defaultLogger;
  const modules = options.modules ?? defaultSeedModules;
  const refresh = options.refresh ?? false;
  const source = options.source ?? "script";

  if (options.onlyIfEmpty) {
    const userCount = await prisma.user.count();

    if (userCount > 0) {
      logger.info(
        "[SEEDS] Skipping seed run because the database is not empty.",
      );
      return {
        executed: false,
        moduleNames: modules.map((module) => module.name),
        reason: "database-not-empty",
        refresh,
        source,
      };
    }
  }

  logger.info(
    `[SEEDS] Starting seed orchestrator source=${source} refresh=${refresh ? "true" : "false"}.`,
  );

  const state = {
    organizationIdsByOwnerEmail: new Map<string, string>(),
    postingOrganizationIdsByPostingId: new Map<string, string>(),
    userIdsByEmail: new Map<string, string>(),
  };

  for (const module of modules) {
    logger.info(`[SEEDS] Running module ${module.name}.`);
    await module.run({
      prisma,
      refresh,
      source,
      logger,
      state,
    });
  }

  logger.info("[SEEDS] Seed orchestrator completed.");
  return {
    executed: true,
    moduleNames: modules.map((module) => module.name),
    refresh,
    source,
  };
}

export async function runAutoSeedsIfNeeded(
  overrides: Pick<
    RunSeedOrchestratorOptions,
    "logger" | "modules" | "prisma"
  > = {},
): Promise<SeedSummary> {
  const prisma = overrides.prisma ?? getDatabaseClient();
  const logger = overrides.logger ?? defaultLogger;
  const databaseConfig = environment.getDatabaseConfig();
  const userCount = await prisma.user.count();
  const policy = resolveAutoSeedPolicy({
    autoSeedEnabled: databaseConfig.autoSeedEnabled,
    autoSeedRefresh: databaseConfig.autoSeedRefresh,
    nodeEnv: environment.getNodeEnvironment(),
    userCount,
  });

  if (!policy.shouldRun) {
    logger.info(`[SEEDS] Auto-seed skipped reason=${policy.reason}.`);
    return {
      executed: false,
      moduleNames: (overrides.modules ?? defaultSeedModules).map(
        (module) => module.name,
      ),
      reason: policy.reason,
      refresh: policy.refresh,
      source: "startup",
    };
  }

  return runSeedOrchestrator({
    ...overrides,
    onlyIfEmpty: false,
    refresh: policy.refresh,
    source: "startup",
  });
}
