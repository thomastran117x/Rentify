import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";

let database: PrismaClient | null = null;
const databaseLogger = loggerFactory.forComponent("database", "resource");

// The adapter exposes no pool option surface -- its options argument only
// carries `database`, `useTextProtocol`, and `onConnectionError` -- but it
// forwards the connection string to mariadb.createPool(), which reads pool
// options from the query string. So pool sizing rides on the URL.
//
// Configured values always win over anything embedded in DATABASE_URL, so the
// documented knob is the effective one.
function buildAdapterConnectionString(
  config: ReturnType<typeof environment.getDatabaseConfig>,
): string {
  try {
    const url = new URL(config.url);
    url.searchParams.set("connectionLimit", String(config.poolConnectionLimit));
    url.searchParams.set("minimumIdle", String(config.poolMinimumIdle));
    return url.toString();
  } catch {
    // Never log the URL itself here -- it carries the database password. The
    // adapter applies the same fallback internally, so behavior is unchanged
    // beyond losing the pool sizing.
    databaseLogger.warn(
      "Database URL could not be parsed, so connection pool sizing was not applied.",
    );
    return config.url;
  }
}

function createDatabaseClient(): PrismaClient {
  const config = environment.getDatabaseConfig();
  // Prisma 7 connects through a driver adapter rather than reading the URL
  // from schema.prisma, so the connection string is supplied here.
  const client = new PrismaClient({
    adapter: new PrismaMariaDb(buildAdapterConnectionString(config)),
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
