import { randomUUID } from "node:crypto";
import type { RootServiceContainer } from "@/configuration/container/core";
import { registerApplicationServices } from "@/configuration/container/registrations";
import {
  containerTokens,
  createRootContainer,
  disposeContainer,
  setContainer,
} from "@/configuration/bootstrap/container";
import { createApplication } from "@/configuration/bootstrap/application";
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
import { disconnectElasticsearch } from "@/configuration/resources/elasticsearch";
import { disconnectRabbitMq } from "@/configuration/resources/rabbitmq";
import type { AuthRepository } from "@/features/auth/auth.repository";
import type { TokenService } from "@/features/auth/token/token.service";
import { runSeedOrchestrator } from "@/seeds/orchestrator";
import { SEED_DEVICES } from "@/seeds/fixtures/users";

const DEFAULT_DATABASE_URL = "mysql://rent:rent@127.0.0.1:3307/rent";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6380";
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
  emailQueueService: {
    enqueueEmailJob: jest.Mock<Promise<void>, [string, unknown]>;
  };
  googleOAuthService: {
    verify: jest.Mock<Promise<Record<string, unknown>>, [Record<string, unknown>]>;
  };
  microsoftOAuthService: {
    verify: jest.Mock<Promise<Record<string, unknown>>, [Record<string, unknown>]>;
  };
  appleOAuthService: {
    verify: jest.Mock<Promise<Record<string, unknown>>, [Record<string, unknown>]>;
  };
  blobService: {
    isConfigured: jest.Mock<boolean, []>;
    isManagedBlobUrl: jest.Mock<boolean, [string, string]>;
  };
  postingThumbnailQueueService: {
    enqueuePostingThumbnailJob: jest.Mock<Promise<void>, [string]>;
  };
  postingsPublicAutocompleteService: {
    autocompletePublic: jest.Mock<Promise<Record<string, unknown>>, [Record<string, unknown>]>;
  };
  recommendationActivityPublisher: {
    publishPostingLifecycle: jest.Mock<Promise<void>, [Record<string, unknown>]>;
    publishPostingView: jest.Mock<Promise<void>, [Record<string, unknown>]>;
    publishSearchClick: jest.Mock<Promise<void>, [Record<string, unknown>]>;
    publishBookingRequestCreated: jest.Mock<Promise<void>, [Record<string, unknown>]>;
    publishRentingConfirmed: jest.Mock<Promise<void>, [Record<string, unknown>]>;
  };
  postingsPublicSearchService: {
    searchPublic: jest.Mock<Promise<Record<string, unknown>>, [Record<string, unknown>]>;
  };
  reportsSearchIndexService: {
    isElasticsearchEnabled: jest.Mock<boolean, []>;
    ensureIndex: jest.Mock<Promise<void>, []>;
    search: jest.Mock<
      Promise<{ ids: string[]; total: number }>,
      [Record<string, unknown>]
    >;
    upsertDocument: jest.Mock<Promise<void>, [Record<string, unknown>]>;
    deleteDocument: jest.Mock<Promise<void>, [string]>;
    bulkUpsertDocuments: jest.Mock<Promise<void>, [Record<string, unknown>[]]>;
  };
  paymentProvider: {
    createPaymentSession: jest.Mock<Promise<Record<string, unknown>>, [Record<string, unknown>]>;
    getPaymentStatus: jest.Mock<Promise<Record<string, unknown> | null>, [Record<string, unknown>]>;
    createRefund: jest.Mock<Promise<Record<string, unknown>>, [Record<string, unknown>]>;
    verifyWebhookSignature: jest.Mock<Record<string, unknown>, [string, string | undefined]>;
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
  userId: string;
  deviceId: string;
  email: string;
  role: string;
  headers(extraHeaders?: Record<string, string>): Record<string, string>;
  cookieHeader(extraCookies?: Record<string, string>): string;
}

export interface PersistenceTestApp {
  app: ReturnType<typeof createApplication>;
  container: RootServiceContainer;
  prisma: ReturnType<typeof getDatabaseClient>;
  stubs: PersistenceTestStubs;
}

let activePersistenceApp: PersistenceTestApp | null = null;

export function applyPersistenceTestEnvironment(
  overrides: {
    databaseUrl?: string;
    redisUrl?: string;
  } = {},
): void {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL =
    overrides.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  process.env.REDIS_URL =
    overrides.redisUrl ?? process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
  process.env.REDIS_HOST = process.env.REDIS_HOST ?? "127.0.0.1";
  process.env.REDIS_PORT = process.env.REDIS_PORT ?? "6380";
  process.env.REDIS_DB = process.env.REDIS_DB ?? "0";
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
  process.env.ELASTICSEARCH_ENABLED = "false";
  process.env.RABBITMQ_URL = "";
  process.env.FRONTEND_URL =
    process.env.FRONTEND_URL ?? "http://localhost:3040";
  process.env.APP_BASE_URL =
    process.env.APP_BASE_URL ?? "http://localhost:3040";
  process.env.CAPTCHA_ALLOWED_HOSTS =
    process.env.CAPTCHA_ALLOWED_HOSTS ?? "challenges.cloudflare.com";
  process.env.MFA_BYPASS_EMAILS =
    process.env.MFA_BYPASS_EMAILS ?? "user1@rentify.local";
}

export async function createPersistenceTestApp(
  options: PersistenceTestAppOptions = {},
): Promise<PersistenceTestApp> {
  applyPersistenceTestEnvironment(options);
  loadEnvironment();
  await connectDatabase();
  await connectRedis();
  await disposeContainer();

  const stubs = createPersistenceTestStubs();
  const container = createRootContainer();
  registerApplicationServices(container);
  registerDefaultPersistenceOverrides(container, stubs);
  options.registerOverrides?.(container, stubs);
  container.validate();
  setContainer(container);

  const app = createApplication();
  const result = {
    app,
    container,
    prisma: getDatabaseClient(),
    stubs,
  } satisfies PersistenceTestApp;

  activePersistenceApp = result;
  return result;
}

export async function teardownPersistenceTestApp(): Promise<void> {
  activePersistenceApp = null;
  await disposeContainer();
  await Promise.allSettled([
    disconnectRabbitMq(),
    disconnectRedis(),
    disconnectDatabase(),
    disconnectElasticsearch(),
  ]);
}

export async function resetPersistenceState(): Promise<void> {
  const prisma = getDatabaseClient();
  const redis = getRedisClient();

  await redis.flushDb();

  const currentDatabase = await prisma.$queryRawUnsafe<
    Array<{ name: string | null }>
  >("SELECT DATABASE() AS name");
  const databaseName = currentDatabase[0]?.name;

  if (!databaseName) {
    throw new Error("Could not determine the active database name.");
  }

  const tables = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${databaseName}' AND TABLE_TYPE = 'BASE TABLE'`,
  );

  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const table of tables) {
      if (table.TABLE_NAME === "_prisma_migrations") {
        continue;
      }

      await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table.TABLE_NAME}\``);
    }
  } finally {
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  }

  await runSeedOrchestrator({
    refresh: false,
    source: "test",
  });
  await redis.flushDb();
}

export async function createAuthenticatedRequestContext(input: {
  email: string;
  deviceId?: string;
  sessionId?: string;
}): Promise<AuthenticatedRequestContext> {
  const persistenceApp = requirePersistenceApp();
  const authRepository = persistenceApp.container.resolve<AuthRepository>(
    containerTokens.authRepository,
  );
  const tokenService = persistenceApp.container.resolve<TokenService>(
    containerTokens.tokenService,
  );

  const user = await authRepository.findUserByEmail(input.email);
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
      userId: user.id,
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
    userId: user.id,
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

export function requirePersistenceApp(): PersistenceTestApp {
  if (!activePersistenceApp) {
    throw new Error(
      "Persistence test app has not been created. Call createPersistenceTestApp() first.",
    );
  }

  return activePersistenceApp;
}

function createPersistenceTestStubs(): PersistenceTestStubs {
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
    emailQueueService: {
      enqueueEmailJob: jest.fn(
        async (_kind: string, _payload: unknown) => undefined,
      ),
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
    postingThumbnailQueueService: {
      enqueuePostingThumbnailJob: jest.fn(
        async (_postingId: string) => undefined,
      ),
    },
    postingsPublicAutocompleteService: {
      autocompletePublic: jest.fn(async (_input: Record<string, unknown>) => ({
        items: [],
      })),
    },
    recommendationActivityPublisher: {
      publishPostingLifecycle: jest.fn(
        async (_input: Record<string, unknown>) => undefined,
      ),
      publishPostingView: jest.fn(
        async (_input: Record<string, unknown>) => undefined,
      ),
      publishSearchClick: jest.fn(
        async (_input: Record<string, unknown>) => undefined,
      ),
      publishBookingRequestCreated: jest.fn(
        async (_input: Record<string, unknown>) => undefined,
      ),
      publishRentingConfirmed: jest.fn(
        async (_input: Record<string, unknown>) => undefined,
      ),
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
    reportsSearchIndexService: {
      isElasticsearchEnabled: jest.fn(() => false),
      ensureIndex: jest.fn(async () => undefined),
      search: jest.fn(async (_input: Record<string, unknown>) => ({
        ids: [],
        total: 0,
      })),
      upsertDocument: jest.fn(
        async (_input: Record<string, unknown>) => undefined,
      ),
      deleteDocument: jest.fn(async (_id: string) => undefined),
      bulkUpsertDocuments: jest.fn(
        async (_documents: Record<string, unknown>[]) => undefined,
      ),
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
    resolve: () => stubs.captchaService as never,
  });
  container.register({
    token: containerTokens.emailQueueService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.emailQueueService as never,
  });
  container.register({
    token: containerTokens.googleOAuthService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.googleOAuthService as never,
  });
  container.register({
    token: containerTokens.microsoftOAuthService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.microsoftOAuthService as never,
  });
  container.register({
    token: containerTokens.appleOAuthService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.appleOAuthService as never,
  });
  container.register({
    token: containerTokens.blobService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.blobService as never,
  });
  container.register({
    token: containerTokens.postingThumbnailQueueService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.postingThumbnailQueueService as never,
  });
  container.register({
    token: containerTokens.postingsPublicAutocompleteService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.postingsPublicAutocompleteService as never,
  });
  container.register({
    token: containerTokens.recommendationActivityPublisher,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.recommendationActivityPublisher as never,
  });
  container.register({
    token: containerTokens.postingsPublicSearchService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.postingsPublicSearchService as never,
  });
  container.register({
    token: containerTokens.reportsSearchIndexService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.reportsSearchIndexService as never,
  });
  container.register({
    token: containerTokens.paymentProvider,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => stubs.paymentProvider as never,
  });
}




