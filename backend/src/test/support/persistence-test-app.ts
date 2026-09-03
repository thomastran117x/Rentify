import { randomUUID } from "node:crypto";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { RootServiceContainer } from "@/configuration/container/core";
import { registerApplicationServices } from "@/configuration/container/registrations";
import {
  containerTokens,
  createRootContainer,
  disposeContainer,
  setContainer,
} from "@/configuration/bootstrap/container";
import { createApplication } from "@/configuration/bootstrap/application";
import { createFetchApp, type FetchApp } from "./fetch-app";
import { loadEnvironment } from "@/configuration/environment";
import {
  connectDatabase,
  disconnectDatabase,
  getDatabaseClient,
} from "@/configuration/resources/database";
import {
  connectRedis,
  disconnectRedis,
  getRedisClient,
} from "@/configuration/resources/redis";
import {
  connectElasticsearch,
  disconnectElasticsearch,
} from "@/configuration/resources/elasticsearch";
import {
  connectRabbitMq,
  disconnectRabbitMq,
} from "@/configuration/resources/rabbitmq";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { TokenService } from "@/features/auth/token/token.service";
import { runSeedOrchestrator } from "@/seeds/orchestrator";
import { SEED_DEVICES } from "@/seeds/fixtures/users";
import {
  assertElasticsearchAvailable,
  assertSafeElasticsearchTarget,
  createLiveElasticsearchConfig,
  deleteElasticsearchIndicesByPrefix,
  type LiveElasticsearchConfig,
} from "./live-elasticsearch";
import {
  assertRabbitMqEndpointsShareBroker,
  assertRabbitMqManagementAvailable,
  assertSafeRabbitMqTarget,
  createLiveRabbitMqConfig,
  createRabbitMqTestVhost,
  deleteRabbitMqTestVhost,
  purgeRabbitMqQueues,
  sweepStaleRabbitMqTestVhosts,
  RABBITMQ_TEST_VHOST_PREFIX,
  type LiveRabbitMqConfig,
} from "./live-rabbitmq";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";

const DEFAULT_DATABASE_URL = "mysql://rent:rent@127.0.0.1:3307/rent_test";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6380/15";
const SAFE_DATABASE_NAME_PATTERN = /(^|[_-])(test|ci|spec)([_-]|$)/i;
const ACCESS_TOKEN_TTL_FALLBACK_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_FALLBACK_SECONDS = 30 * 24 * 60 * 60;

type CaptchaVerificationResult = {
  success: boolean;
  failOpen: boolean;
  errors: string[];
  hostname?: string;
  action?: string;
  challengeTimestamp?: string;
};

export interface PersistenceTestStubs {
  captchaService: {
    verify: jest.Mock<
      Promise<CaptchaVerificationResult>,
      [
        {
          token?: string | null;
          remoteIp?: string;
          idempotencyKey?: string;
        },
      ]
    >;
  };
  googleOAuthService: {
    verify: jest.Mock<
      Promise<Record<string, unknown>>,
      [Record<string, unknown>]
    >;
  };
  microsoftOAuthService: {
    verify: jest.Mock<
      Promise<Record<string, unknown>>,
      [Record<string, unknown>]
    >;
  };
  appleOAuthService: {
    verify: jest.Mock<
      Promise<Record<string, unknown>>,
      [Record<string, unknown>]
    >;
  };
  blobService: {
    isConfigured: jest.Mock<boolean, []>;
    isManagedBlobUrl: jest.Mock<boolean, [string, string]>;
    createUploadUrl: jest.Mock<Record<string, unknown>, [BlobUploadInput]>;
    uploadLocalBlob: jest.Mock<Promise<void>, [BlobUploadPayload]>;
    readLocalBlob: jest.Mock<
      Promise<{ contentType: string; body: Buffer }>,
      [string]
    >;
    deleteBlobForUser: jest.Mock<Promise<void>, [string, string]>;
    /** In-memory contents, so a stored upload can be read back over HTTP. */
    storage: Map<string, { contentType: string; body: Buffer }>;
  };
  postingsPublicAutocompleteService: {
    autocompletePublic: jest.Mock<
      Promise<Record<string, unknown>>,
      [Record<string, unknown>]
    >;
  };
  postingsPublicSearchService: {
    searchPublic: jest.Mock<
      Promise<Record<string, unknown>>,
      [Record<string, unknown>]
    >;
  };
  paymentProvider: {
    createPaymentSession: jest.Mock<
      Promise<Record<string, unknown>>,
      [Record<string, unknown>]
    >;
    getPaymentStatus: jest.Mock<
      Promise<Record<string, unknown> | null>,
      [Record<string, unknown>]
    >;
    createRefund: jest.Mock<
      Promise<Record<string, unknown>>,
      [Record<string, unknown>]
    >;
    verifyWebhookSignature: jest.Mock<
      Record<string, unknown>,
      [string, string | undefined]
    >;
    classifyError: jest.Mock<Record<string, unknown>, [unknown]>;
  };
}

export interface PersistenceTestAppOptions {
  databaseUrl?: string;
  redisUrl?: string;
  registerOverrides?: (
    container: RootServiceContainer,
    stubs: PersistenceTestStubs,
  ) => void;
}

export interface AuthenticatedRequestContext {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  userId: Uuid;
  deviceId: string;
  email: string;
  role: string;
  headers(extraHeaders?: Record<string, string>): Record<string, string>;
  cookieHeader(extraCookies?: Record<string, string>): string;
}

export interface PersistenceTestInfrastructure {
  sessionId: string;
  elasticsearch: LiveElasticsearchConfig;
  rabbitMq: LiveRabbitMqConfig;
}

export interface PersistenceTestApp {
  /**
   * The composed Express app, wrapped so the suites can keep driving it with
   * `app.request(url, init)`. See src/test/support/fetch-app.ts for why that
   * calling convention is preserved.
   */
  app: FetchApp;
  container: RootServiceContainer;
  infra: PersistenceTestInfrastructure;
  prisma: ReturnType<typeof getDatabaseClient>;
  stubs: PersistenceTestStubs;
}

let activePersistenceApp: PersistenceTestApp | null = null;
let activePersistenceInfrastructure: PersistenceTestInfrastructure | null =
  null;
let activePersistenceInfrastructureReady = false;

export function applyPersistenceTestEnvironment(
  overrides: {
    databaseUrl?: string;
    redisUrl?: string;
  } = {},
): void {
  const infra = getOrCreatePersistenceInfrastructure();
  const databaseUrl = overrides.databaseUrl ?? DEFAULT_DATABASE_URL;
  const redisUrl = overrides.redisUrl ?? DEFAULT_REDIS_URL;
  const redisDb = getRedisDatabaseIndexFromUrl(redisUrl) ?? "15";

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.REDIS_HOST = process.env.REDIS_HOST ?? "127.0.0.1";
  process.env.REDIS_PORT = process.env.REDIS_PORT ?? "6380";
  process.env.REDIS_DB = String(redisDb);
  process.env.DATABASE_AUTO_SEED_ENABLED = "false";
  process.env.DATABASE_AUTO_SEED_REFRESH = "false";
  process.env.ACCESS_TOKEN_SECRET =
    process.env.ACCESS_TOKEN_SECRET ?? "seed-test-access-secret-value-32ch";
  process.env.REFRESH_TOKEN_SECRET =
    process.env.REFRESH_TOKEN_SECRET ?? "seed-test-refresh-secret-value-32c";
  process.env.PERSONAL_ACCESS_TOKEN_SECRET =
    process.env.PERSONAL_ACCESS_TOKEN_SECRET ??
    "seed-test-personal-access-token-32";
  process.env.MFA_TOTP_ENCRYPTION_KEY =
    process.env.MFA_TOTP_ENCRYPTION_KEY ?? "0".repeat(64);
  process.env.GMAIL_USER = process.env.GMAIL_USER ?? "seed-test@example.com";
  process.env.GMAIL_APP_PASSWORD =
    process.env.GMAIL_APP_PASSWORD ?? "seed-test-password";
  process.env.SMS_PROVIDER = process.env.SMS_PROVIDER ?? "noop";
  process.env.SMS_WORKER_PREFETCH = process.env.SMS_WORKER_PREFETCH ?? "10";
  process.env.SMS_MAX_ATTEMPTS = process.env.SMS_MAX_ATTEMPTS ?? "8";
  process.env.SQUARE_ACCESS_TOKEN =
    process.env.SQUARE_ACCESS_TOKEN ?? "seed-test-square-token";
  process.env.SQUARE_LOCATION_ID =
    process.env.SQUARE_LOCATION_ID ?? "seed-test-location";
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY =
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "seed-test-signature";
  process.env.SQUARE_WEBHOOK_NOTIFICATION_URL =
    process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ??
    "http://localhost:8040/api/v1/payments/webhooks/square";
  process.env.ELASTICSEARCH_ENABLED = "true";
  process.env.ELASTICSEARCH_URL = infra.elasticsearch.url;
  process.env.ELASTICSEARCH_POSTINGS_INDEX =
    infra.elasticsearch.postingsIndexName;
  process.env.ELASTICSEARCH_REPORTS_INDEX =
    infra.elasticsearch.reportsIndexName;
  process.env.RABBITMQ_URL = infra.rabbitMq.amqpUrl;
  process.env.FRONTEND_URL =
    process.env.FRONTEND_URL ?? "http://localhost:3040";
  process.env.APP_BASE_URL =
    process.env.APP_BASE_URL ?? "http://localhost:3040";
  process.env.CAPTCHA_ALLOWED_HOSTS =
    process.env.CAPTCHA_ALLOWED_HOSTS ?? "challenges.cloudflare.com";
  process.env.MFA_BYPASS_EMAILS =
    process.env.MFA_BYPASS_EMAILS ?? "user1@rentify.local";

  assertSafePersistenceResetTargets({
    databaseUrl,
    redisUrl,
    redisDb: String(redisDb),
    elasticsearch: infra.elasticsearch,
    rabbitMq: infra.rabbitMq,
  });
}

export async function createPersistenceTestApp(
  options: PersistenceTestAppOptions = {},
): Promise<PersistenceTestApp> {
  const infra = await initializePersistenceInfrastructure();
  applyPersistenceTestEnvironment(options);
  loadEnvironment();
  await connectDatabase();
  await connectRedis();
  await connectElasticsearch();
  await connectRabbitMq();
  await disposeContainer();

  const stubs = createPersistenceTestStubs();
  const container = createRootContainer();
  registerApplicationServices(container);
  registerDefaultPersistenceOverrides(container, stubs);
  options.registerOverrides?.(container, stubs);
  container.validate();
  setContainer(container);

  const app = createFetchApp(createApplication());
  const result = {
    app,
    container,
    infra,
    prisma: getDatabaseClient(),
    stubs,
  } satisfies PersistenceTestApp;

  activePersistenceApp = result;
  return result;
}

export async function teardownPersistenceTestApp(): Promise<void> {
  const infra = activePersistenceInfrastructure;

  activePersistenceApp = null;
  activePersistenceInfrastructure = null;
  activePersistenceInfrastructureReady = false;

  // Drop the seed snapshot before disconnecting so a schema change in a later
  // run can never be restored from a stale copy.
  if (seedSnapshotReady) {
    try {
      await dropSeedSnapshot(getDatabaseClient());
    } catch {
      // A failed cleanup only costs the next run a fresh capture.
    }
    seedSnapshotReady = false;
  }

  await disposeContainer();
  await Promise.allSettled([
    disconnectRabbitMq(),
    disconnectRedis(),
    disconnectDatabase(),
    disconnectElasticsearch(),
  ]);

  if (infra) {
    const cleanupResults = await Promise.allSettled([
      deleteRabbitMqTestVhost(infra.rabbitMq),
      deleteElasticsearchIndicesByPrefix(infra.elasticsearch),
    ]);

    // Cleanup failures leak a vhost or index prefix into the next run. They are
    // not worth failing a passing suite over, but they must not be silent.
    const cleanupTargets = [
      `RabbitMQ vhost '${infra.rabbitMq.vhost}'`,
      `Elasticsearch index prefix '${infra.elasticsearch.indexPrefix}'`,
    ];

    cleanupResults.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn(
          `[persistence-test-app] Failed to clean up ${cleanupTargets[index]}: ` +
            `${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    });
  }
}

export async function resetPersistenceState(): Promise<void> {
  const infra = requirePersistenceInfrastructure();

  assertSafePersistenceResetTargets({
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    redisDb: process.env.REDIS_DB,
    elasticsearch: infra.elasticsearch,
    rabbitMq: infra.rabbitMq,
  });

  const prisma = getDatabaseClient();
  const redis = getRedisClient();

  await redis.flushDb();
  await purgeRabbitMqQueues(infra.rabbitMq);
  await deleteElasticsearchIndicesByPrefix(infra.elasticsearch);

  const tables = await listSeededTables(prisma);

  await clearSeededTables(prisma, tables);

  if (seedSnapshotReady) {
    await restoreSeedSnapshot(prisma, tables);
  } else {
    await runSeedOrchestrator({
      refresh: false,
      source: "test",
    });
    await captureSeedSnapshot(prisma, tables);
    seedSnapshotReady = true;
  }

  await redis.flushDb();
}

/**
 * Rebuilding the seed data through the orchestrator costs about 17 seconds
 * because it upserts every fixture row by row. Truncating costs about 0.2
 * seconds, so the reset is dominated entirely by reseeding.
 *
 * The orchestrator therefore runs once per test file, and every later reset
 * restores that result from snapshot tables held in the same schema. Copying
 * server side with `INSERT ... SELECT` keeps every column type exact and needs
 * no round trip through the client.
 */
const SNAPSHOT_TABLE_PREFIX = "zz_seed_snapshot__";

let seedSnapshotReady = false;

async function listSeededTables(
  prisma: ReturnType<typeof getDatabaseClient>,
): Promise<string[]> {
  const tables = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  );

  return tables
    .map((table) => table.TABLE_NAME)
    .filter(
      (name) =>
        name !== "_prisma_migrations" &&
        !name.startsWith(SNAPSHOT_TABLE_PREFIX),
    );
}

async function clearSeededTables(
  prisma: ReturnType<typeof getDatabaseClient>,
  tables: string[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of tables) {
        await tx.$executeRawUnsafe(`DELETE FROM \`${table}\``);
      }
    } finally {
      await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
    }
  });
}

async function captureSeedSnapshot(
  prisma: ReturnType<typeof getDatabaseClient>,
  tables: string[],
): Promise<void> {
  for (const table of tables) {
    const snapshot = `${SNAPSHOT_TABLE_PREFIX}${table}`;
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS \`${snapshot}\``);
    // LIKE copies columns and indexes but not foreign keys, which is what a
    // detached copy wants.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE \`${snapshot}\` LIKE \`${table}\``,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO \`${snapshot}\` SELECT * FROM \`${table}\``,
    );
  }
}

async function restoreSeedSnapshot(
  prisma: ReturnType<typeof getDatabaseClient>,
  tables: string[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of tables) {
        await tx.$executeRawUnsafe(
          `INSERT INTO \`${table}\` SELECT * FROM \`${SNAPSHOT_TABLE_PREFIX}${table}\``,
        );
      }
    } finally {
      await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
    }
  });
}

async function dropSeedSnapshot(
  prisma: ReturnType<typeof getDatabaseClient>,
): Promise<void> {
  const snapshots = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '${SNAPSHOT_TABLE_PREFIX}%'`,
  );

  for (const snapshot of snapshots) {
    await prisma.$executeRawUnsafe(
      `DROP TABLE IF EXISTS \`${snapshot.TABLE_NAME}\``,
    );
  }
}

export async function createAuthenticatedRequestContext(input: {
  email: string;
  deviceId?: string;
  sessionId?: string;
}): Promise<AuthenticatedRequestContext> {
  const persistenceApp = requirePersistenceApp();
  const usersRepository = persistenceApp.container.resolve<UsersRepository>(
    containerTokens.authUsersRepository,
  );
  const tokenService = persistenceApp.container.resolve<TokenService>(
    containerTokens.tokenService,
  );

  const user = await usersRepository.findUserByEmail(input.email);
  if (!user) {
    throw new Error(`Could not find seeded user for email: ${input.email}`);
  }

  const sessionId = input.sessionId ?? randomUUID();
  const deviceId =
    input.deviceId ??
    SEED_DEVICES.find((device) => device.userEmail === input.email)?.deviceId ??
    `test-device-${user.id}`;
  const accessTokenTtlSeconds =
    tokenService.getAccessTokenExpiresInSeconds?.() ??
    ACCESS_TOKEN_TTL_FALLBACK_SECONDS;
  const refreshTokenTtlSeconds =
    tokenService.getRefreshTokenExpiresInSeconds?.(false) ??
    REFRESH_TOKEN_TTL_FALLBACK_SECONDS;

  await tokenService.createSession(
    {
      sessionId,
      userId: asUuid(user.id),
      deviceId,
      tokenVersion: user.tokenVersion,
    },
    Math.max(accessTokenTtlSeconds, refreshTokenTtlSeconds),
  );

  const accessToken = tokenService.createAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    deviceId,
    sessionId,
    tokenVersion: user.tokenVersion,
  });
  const refreshToken = await tokenService.createRefreshToken({
    sub: user.id,
    deviceId,
    sessionId,
    tokenVersion: user.tokenVersion,
  });

  return {
    accessToken,
    refreshToken,
    sessionId,
    userId: asUuid(user.id),
    deviceId,
    email: user.email,
    role: user.role,
    headers(extraHeaders = {}) {
      return {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...extraHeaders,
      };
    },
    cookieHeader(extraCookies = {}) {
      const cookies = {
        refresh_token: refreshToken,
        ...extraCookies,
      };
      return Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
  };
}

function assertSafePersistenceResetTargets(input: {
  databaseUrl?: string;
  redisUrl?: string;
  redisDb?: string;
  elasticsearch?: LiveElasticsearchConfig;
  rabbitMq?: LiveRabbitMqConfig;
}): void {
  const databaseUrl = input.databaseUrl?.trim();
  const redisUrl = input.redisUrl?.trim();

  if (!databaseUrl) {
    throw new Error(
      "Persistence tests require DATABASE_URL to point at an explicitly test-scoped database.",
    );
  }

  const databaseName = getDatabaseNameFromUrl(databaseUrl);
  if (!databaseName || !SAFE_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing to run persistence test resets against non-test database '${databaseName ?? databaseUrl}'. Use a test-scoped schema such as 'rent_test'.`,
    );
  }

  if (!redisUrl) {
    throw new Error(
      "Persistence tests require REDIS_URL to point at an isolated Redis database.",
    );
  }

  const redisDb =
    input.redisDb?.trim() || getRedisDatabaseIndexFromUrl(redisUrl) || "0";
  const redisDbNumber = Number.parseInt(redisDb, 10);
  if (!Number.isInteger(redisDbNumber) || redisDbNumber <= 0) {
    throw new Error(
      `Refusing to flush Redis database '${redisDb}'. Use a non-zero, test-scoped Redis DB such as '${DEFAULT_REDIS_URL}'.`,
    );
  }

  if (input.elasticsearch) {
    assertSafeElasticsearchTarget(input.elasticsearch);
  }

  if (input.rabbitMq) {
    assertSafeRabbitMqTarget(input.rabbitMq);
  }
}

function getDatabaseNameFromUrl(databaseUrl: string): string | null {
  try {
    const parsedUrl = new URL(databaseUrl);
    const databaseName = parsedUrl.pathname.replace(/^\/+/, "").trim();
    return databaseName || null;
  } catch {
    throw new Error(
      `Could not parse DATABASE_URL '${databaseUrl}' for persistence test safety checks.`,
    );
  }
}

function getRedisDatabaseIndexFromUrl(redisUrl: string): string | null {
  try {
    const parsedUrl = new URL(redisUrl);
    const databaseIndex = parsedUrl.pathname.replace(/^\/+/, "").trim();
    return databaseIndex || null;
  } catch {
    throw new Error(
      `Could not parse REDIS_URL '${redisUrl}' for persistence test safety checks.`,
    );
  }
}

function getOrCreatePersistenceInfrastructure(): PersistenceTestInfrastructure {
  if (!activePersistenceInfrastructure) {
    const sessionId = randomUUID();

    activePersistenceInfrastructure = {
      sessionId,
      elasticsearch: createLiveElasticsearchConfig(sessionId),
      rabbitMq: createLiveRabbitMqConfig(sessionId),
    };
  }

  return activePersistenceInfrastructure;
}

function requirePersistenceInfrastructure(): PersistenceTestInfrastructure {
  if (!activePersistenceInfrastructure) {
    throw new Error(
      "Persistence test infrastructure has not been initialized. Call createPersistenceTestApp() first.",
    );
  }

  return activePersistenceInfrastructure;
}

async function initializePersistenceInfrastructure(): Promise<PersistenceTestInfrastructure> {
  const infrastructure = getOrCreatePersistenceInfrastructure();

  if (activePersistenceInfrastructureReady) {
    return infrastructure;
  }

  const { elasticsearch, rabbitMq } = infrastructure;

  await runInfrastructurePhase(
    "elasticsearch:available",
    `url ${elasticsearch.url}`,
    () => assertElasticsearchAvailable(elasticsearch),
  );
  await runInfrastructurePhase(
    "elasticsearch:clean-indices",
    `index prefix '${elasticsearch.indexPrefix}'`,
    () => deleteElasticsearchIndicesByPrefix(elasticsearch),
  );
  await runInfrastructurePhase(
    "rabbitmq:management-available",
    `management ${rabbitMq.managementUrl}`,
    () => assertRabbitMqManagementAvailable(rabbitMq),
  );
  await runInfrastructurePhase(
    "rabbitmq:sweep-stale-vhosts",
    `prefix '${RABBITMQ_TEST_VHOST_PREFIX}'`,
    () => sweepStaleRabbitMqTestVhosts(rabbitMq),
  );
  await runInfrastructurePhase(
    "rabbitmq:create-vhost",
    `vhost '${rabbitMq.vhost}'`,
    () => createRabbitMqTestVhost(rabbitMq),
  );
  await runInfrastructurePhase(
    "rabbitmq:verify-broker-identity",
    `vhost '${rabbitMq.vhost}'`,
    () => assertRabbitMqEndpointsShareBroker(rabbitMq),
  );

  activePersistenceInfrastructureReady = true;
  return infrastructure;
}

/**
 * Annotates a setup failure with the lifecycle phase and the safe target it was
 * acting on. Without this, an infrastructure misconfiguration surfaces as a bare
 * driver error (for example `Expected ConnectionOpenOk; got <ConnectionClose>`)
 * with no indication of which step or which resource failed.
 */
async function runInfrastructurePhase<TResult>(
  phase: string,
  target: string,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(
      `Persistence test infrastructure setup failed during '${phase}' (${target}): ` +
        `${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function requirePersistenceApp(): PersistenceTestApp {
  if (!activePersistenceApp) {
    throw new Error(
      "Persistence test app has not been created. Call createPersistenceTestApp() first.",
    );
  }

  return activePersistenceApp;
}

interface BlobUploadInput {
  filename: string;
  contentType: string;
  scope?: string;
}

interface BlobUploadPayload {
  blobName: string;
  contentType: string;
  body: Buffer | Uint8Array;
}

function createPersistenceTestStubs(): PersistenceTestStubs {
  const blobStorage = new Map<string, { contentType: string; body: Buffer }>();

  return {
    captchaService: {
      verify: jest.fn(async ({ token }) => {
        const normalized = token?.trim();

        if (
          normalized === "local-dev-bypass" ||
          normalized?.startsWith("captcha-ok")
        ) {
          return {
            success: true,
            failOpen: false,
            errors: [],
            action: "test-bypass",
          };
        }

        return {
          success: false,
          failOpen: false,
          errors: normalized
            ? ["invalid-input-response"]
            : ["missing-input-response"],
        };
      }),
    },
    googleOAuthService: {
      verify: jest.fn(async (_input: Record<string, unknown>) => ({
        provider: "google",
        providerUserId: "google-user-test",
        email: "google-user@rentify.local",
        emailVerified: true,
        firstName: "Google",
        lastName: "Tester",
      })),
    },
    microsoftOAuthService: {
      verify: jest.fn(async (_input: Record<string, unknown>) => ({
        provider: "microsoft",
        providerUserId: "microsoft-user-test",
        email: "microsoft-user@rentify.local",
        emailVerified: true,
        firstName: "Microsoft",
        lastName: "Tester",
      })),
    },
    appleOAuthService: {
      verify: jest.fn(async (_input: Record<string, unknown>) => ({
        provider: "apple",
        providerUserId: "apple-user-test",
        email: "apple-user@rentify.local",
        emailVerified: true,
        firstName: "Apple",
        lastName: "Tester",
      })),
    },
    blobService: {
      // Blob storage is a third-party SDK, and the production service's
      // local-disk fallback is deliberately development-only. The endpoints are
      // still exercised end to end over HTTP; only the bytes live in memory.
      storage: blobStorage,
      createUploadUrl: jest.fn((input: BlobUploadInput) => {
        const blobName = `${input.scope ?? "uploads"}/${input.filename}`;
        return {
          method: "PUT" as const,
          uploadUrl: `http://rent.test/api/v1/blob/upload?blobName=${encodeURIComponent(blobName)}&expiresAt=2099-01-01T00:00:00.000Z&token=test-upload-token`,
          expiresAt: "2099-01-01T00:00:00.000Z",
          blobName,
          blobUrl: `http://rent.test/api/v1/blob/file?blobName=${encodeURIComponent(blobName)}`,
          container: "rent-test",
          headers: {
            "x-ms-blob-type": "BlockBlob" as const,
            "content-type": input.contentType,
          },
          scope: input.scope,
        };
      }),
      uploadLocalBlob: jest.fn(async (input: BlobUploadPayload) => {
        blobStorage.set(input.blobName, {
          contentType: input.contentType,
          body: Buffer.from(input.body),
        });
      }),
      readLocalBlob: jest.fn(async (blobName: string) => {
        const stored = blobStorage.get(blobName);
        if (!stored) {
          throw new ResourceNotFoundError("Blob could not be found.");
        }
        return stored;
      }),
      deleteBlobForUser: jest.fn(async (_userId: string, blobName: string) => {
        blobStorage.delete(blobName);
      }),
      isConfigured: jest.fn(() => true),
      isManagedBlobUrl: jest.fn((blobUrl, blobName) => {
        try {
          const parsed = new URL(blobUrl);
          return (
            parsed.searchParams.get("blobName") === blobName ||
            parsed.pathname.endsWith(blobName)
          );
        } catch {
          return blobUrl.includes(blobName);
        }
      }),
    },
    postingsPublicAutocompleteService: {
      autocompletePublic: jest.fn(async (_input: Record<string, unknown>) => ({
        items: [],
      })),
    },
    postingsPublicSearchService: {
      searchPublic: jest.fn(async (_input: Record<string, unknown>) => ({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      })),
    },
    paymentProvider: {
      createPaymentSession: jest.fn(async (input) => ({
        checkoutUrl: `https://square.example/checkout/${input.paymentId}`,
        providerRequestId: `provider-request-${String(input.paymentId)}`,
        providerPaymentId: `provider-payment-${String(input.paymentId)}`,
        providerOrderId: `provider-order-${String(input.paymentId)}`,
        locationId: "seed-test-location",
        raw: {
          paymentId: input.paymentId,
        },
      })),
      getPaymentStatus: jest.fn(async (input) => ({
        providerPaymentId:
          typeof input.providerPaymentId === "string"
            ? input.providerPaymentId
            : undefined,
        providerOrderId:
          typeof input.providerOrderId === "string"
            ? input.providerOrderId
            : undefined,
        status: "COMPLETED",
        raw: {
          source: "test",
        },
      })),
      createRefund: jest.fn(async (_input: Record<string, unknown>) => ({
        providerRefundId: `provider-refund-${randomUUID()}`,
        status: "COMPLETED",
        raw: {
          source: "test",
        },
      })),
      verifyWebhookSignature: jest.fn((rawBody, signatureHeader) => {
        const payload = JSON.parse(rawBody) as Record<string, unknown>;
        const eventId =
          typeof payload.id === "string"
            ? payload.id
            : typeof payload.event_id === "string"
              ? payload.event_id
              : randomUUID();
        const eventType =
          typeof payload.type === "string" ? payload.type : "payment.updated";

        return {
          isValid: signatureHeader !== "invalid-signature",
          eventId,
          eventType,
          payload,
        };
      }),
      classifyError: jest.fn((error) => ({
        category: "transient",
        code: error instanceof Error ? error.name : "provider-error",
        message: error instanceof Error ? error.message : "Provider error.",
        retryable: true,
      })),
    },
  };
}

function registerDefaultPersistenceOverrides(
  container: RootServiceContainer,
  stubs: PersistenceTestStubs,
): void {
  container.register({
    token: containerTokens.captchaService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.captchaService as any,
  });
  container.register({
    token: containerTokens.googleOAuthService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.googleOAuthService as any,
  });
  container.register({
    token: containerTokens.microsoftOAuthService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.microsoftOAuthService as any,
  });
  container.register({
    token: containerTokens.appleOAuthService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.appleOAuthService as any,
  });
  container.register({
    token: containerTokens.blobService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.blobService as any,
  });
  container.register({
    token: containerTokens.postingsPublicAutocompleteService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.postingsPublicAutocompleteService as any,
  });
  container.register({
    token: containerTokens.postingsPublicSearchService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.postingsPublicSearchService as any,
  });
  container.register({
    token: containerTokens.paymentProvider,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.paymentProvider as any,
  });
}
