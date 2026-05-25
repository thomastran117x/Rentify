import { PrismaClient } from "@prisma/client";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";

let database: PrismaClient | null = null;
const databaseLogger = loggerFactory.forComponent("database", "resource");

function createDatabaseClient(): PrismaClient {
  const config = environment.getDatabaseConfig();
  const client = new PrismaClient({
    log: [
      {
        emit: "event",
        level: "query",
      },
    ],
  });

  client.$on("query", (event) => {
    const shouldLogQuery = config.queryLoggingEnabled;
    const shouldLogSlowQuery =
      config.slowQueryThresholdMs > 0 &&
      event.duration >= config.slowQueryThresholdMs;

    if (!shouldLogQuery && !shouldLogSlowQuery) {
      return;
    }

    const logMethod = shouldLogSlowQuery
      ? databaseLogger.warn.bind(databaseLogger)
      : databaseLogger.info.bind(databaseLogger);

    logMethod("Database query completed.", {
      durationMs: event.duration,
      query: event.query,
      target: event.target,
    });
  });

  return client;
}

export let databaseClient: PrismaClient | null = null;

export async function connectDatabase(): Promise<PrismaClient> {
  const startedAt = performance.now();

  if (!database) {
    database = createDatabaseClient();
    databaseClient = database;
  }

  await database.$connect();
  databaseLogger.info("Database connected.", {
    durationMs: measureDurationMs(startedAt),
  });
  return database;
}

export function getDatabaseClient(): PrismaClient {
  if (!database) {
    throw new Error(
      "Database has not been initialized. Call connectDatabase() first.",
    );
  }

  return database;
}

export async function disconnectDatabase(): Promise<void> {
  if (!database) {
    return;
  }

  const startedAt = performance.now();
  await database.$disconnect();
  database = null;
  databaseClient = null;
  databaseLogger.info("Database disconnected.", {
    durationMs: measureDurationMs(startedAt),
  });
}

export async function pingDatabase(): Promise<{
  durationMs: number;
  ok: boolean;
}> {
  const client = getDatabaseClient();
  const startedAt = performance.now();

  await client.$queryRaw`SELECT 1`;

  return {
    durationMs: measureDurationMs(startedAt),
    ok: true,
  };
}

function measureDurationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}
