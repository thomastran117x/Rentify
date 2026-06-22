import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EnvironmentManager } from "@/configuration/environment/manager";

const ORIGINAL_ENV = { ...process.env };

function buildRequiredEnv(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "mysql://process:process@localhost:3306/rent_process",
    ACCESS_TOKEN_SECRET: "process-access-secret-value-with-32chars",
    REFRESH_TOKEN_SECRET: "process-refresh-secret-value-with-32ch",
    PERSONAL_ACCESS_TOKEN_SECRET: "process-personal-token-secret-32chars",
    GMAIL_USER: "process@example.com",
    GMAIL_APP_PASSWORD: "process-password",
    SQUARE_ACCESS_TOKEN: "process-square-token",
    SQUARE_LOCATION_ID: "process-square-location",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "process-square-signature-key",
    SQUARE_WEBHOOK_NOTIFICATION_URL:
      "http://localhost:8040/api/v1/payments/webhooks/square",
    ...overrides,
  };
}

function serializeEnv(values: NodeJS.ProcessEnv): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

describe("EnvironmentManager", () => {
  let tempDirectory: string;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    tempDirectory = mkdtempSync(join(tmpdir(), "rent-env-manager-"));
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("throws when reading the environment before it has been loaded", () => {
    const manager = new EnvironmentManager();

    expect(() => manager.get()).toThrow(
      "Environment has not been loaded. Call loadEnvironment() during application startup first.",
    );
  });

  it("loads successfully when the optional env file is missing", () => {
    process.env = buildRequiredEnv();

    const manager = new EnvironmentManager({
      envFilePath: join(tempDirectory, ".env"),
    });

    const environment = manager.load();

    expect(environment.database.url).toBe(process.env.DATABASE_URL);
  });

  it("loads values from an optional local env file when present", () => {
    const envFilePath = join(tempDirectory, ".env");
    writeFileSync(
      envFilePath,
      serializeEnv(
        buildRequiredEnv({
          DATABASE_URL: "mysql://file:file@localhost:3306/rent_file",
          FRONTEND_URL: "http://localhost:3041",
        }),
      ),
    );
    process.env = {};

    const manager = new EnvironmentManager({ envFilePath });

    const environment = manager.load();

    expect(environment.database.url).toBe(
      "mysql://file:file@localhost:3306/rent_file",
    );
    expect(environment.cors.allowedOrigins).toEqual(["http://localhost:3041"]);
    expect(process.env.FRONTEND_URL).toBe("http://localhost:3041");
  });

  it("does not let the env file override existing process env values", () => {
    const envFilePath = join(tempDirectory, ".env");
    writeFileSync(
      envFilePath,
      serializeEnv(
        buildRequiredEnv({
          DATABASE_URL: "mysql://file:file@localhost:3306/rent_file",
          ACCESS_TOKEN_SECRET: "file-access-secret-value-with-32chars",
        }),
      ),
    );
    process.env = buildRequiredEnv({
      DATABASE_URL: "mysql://process:process@localhost:3306/rent_process",
      ACCESS_TOKEN_SECRET: "process-access-secret-value-with-32chars",
    });

    const manager = new EnvironmentManager({ envFilePath });

    const environment = manager.load();

    expect(environment.database.url).toBe(
      "mysql://process:process@localhost:3306/rent_process",
    );
    expect(environment.auth.accessTokenSecret).toBe(
      "process-access-secret-value-with-32chars",
    );
    expect(process.env.DATABASE_URL).toBe(
      "mysql://process:process@localhost:3306/rent_process",
    );
  });

  it("returns the cached environment on subsequent loads", () => {
    process.env = buildRequiredEnv({
      DATABASE_URL: "mysql://cached:first@localhost:3306/rent_first",
    });

    const manager = new EnvironmentManager();

    const firstEnvironment = manager.load();

    process.env.DATABASE_URL =
      "mysql://cached:second@localhost:3306/rent_second";

    const secondEnvironment = manager.load();

    expect(secondEnvironment).toBe(firstEnvironment);
    expect(secondEnvironment.database.url).toBe(
      "mysql://cached:first@localhost:3306/rent_first",
    );
  });

  it("exposes the loaded environment through its getters", () => {
    process.env = buildRequiredEnv({
      NODE_ENV: "development",
      FRONTEND_URL: "http://localhost:3041",
      CORS_ALLOWED_ORIGINS: "http://localhost:3041,http://localhost:3042",
      CSRF_ALLOWED_ORIGINS: "http://localhost:3041,http://localhost:3042",
    });

    const manager = new EnvironmentManager();
    const environment = manager.load();

    expect(manager.get()).toBe(environment);
    expect(manager.getNodeEnvironment()).toBe("development");
    expect(manager.isProduction()).toBe(false);
    expect(manager.isDevelopment()).toBe(true);
    expect(manager.isTest()).toBe(false);
    expect(manager.getServerPort()).toBe(environment.server.port);
    expect(manager.getTokenConfig()).toBe(environment.auth);
    expect(manager.getDatabaseConfig()).toBe(environment.database);
    expect(manager.getEmailConfig()).toBe(environment.email);
    expect(manager.getSmsConfig()).toBe(environment.sms);
    expect(manager.getCaptchaConfig()).toBe(environment.captcha);
    expect(manager.getGoogleOAuthConfig()).toBe(environment.oauth.google);
    expect(manager.getMicrosoftOAuthConfig()).toBe(environment.oauth.microsoft);
    expect(manager.getRedisConfig()).toBe(environment.redis);
    expect(manager.getRateLimiterConfig()).toBe(environment.rateLimiter);
    expect(manager.getSearchWorkerConfig()).toBe(environment.workers.search);
    expect(manager.getSearchRelayWorkerConfig()).toBe(
      environment.workers.searchRelay,
    );
    expect(manager.getSearchIndexerWorkerConfig()).toBe(
      environment.workers.searchIndexer,
    );
    expect(manager.getSearchReconcileWorkerConfig()).toBe(
      environment.workers.searchReconcile,
    );
    expect(manager.getSearchReindexWorkerConfig()).toBe(
      environment.workers.searchReindex,
    );
    expect(manager.getEmailWorkerConfig()).toBe(environment.workers.email);
    expect(manager.getSmsWorkerConfig()).toBe(environment.workers.sms);
    expect(manager.getAnalyticsWorkerConfig()).toBe(
      environment.workers.analytics,
    );
    expect(manager.getRecommendationsPrecomputeWorkerConfig()).toBe(
      environment.workers.recommendationsPrecompute,
    );
    expect(manager.getPostingsThumbnailWorkerConfig()).toBe(
      environment.workers.postingsThumbnail,
    );
    expect(manager.getBookingExpiryWorkerConfig()).toBe(
      environment.workers.bookingExpiry,
    );
    expect(manager.getPaymentsRetryWorkerConfig()).toBe(
      environment.workers.paymentsRetry,
    );
    expect(manager.getPaymentsRepairWorkerConfig()).toBe(
      environment.workers.paymentsRepair,
    );
    expect(manager.getPayoutReleaseWorkerConfig()).toBe(
      environment.workers.payoutRelease,
    );
    expect(manager.getPostingsPublicCacheConfig()).toBe(
      environment.postingsCache,
    );
    expect(manager.getBlobStorageConfig()).toBe(environment.blobStorage);
    expect(manager.getLoggingConfig()).toBe(environment.logging);
    expect(manager.getRouteModulesConfig()).toBe(environment.routeModules);
    expect(manager.getRabbitMqConfig()).toBe(environment.rabbitmq);
    expect(manager.getElasticsearchConfig()).toBe(environment.elasticsearch);
    expect(manager.getSquareConfig()).toBe(environment.square);
  });

  it("reports production and test node environments correctly", () => {
    const productionManager = new EnvironmentManager();
    process.env = buildRequiredEnv({
      NODE_ENV: "production",
      RABBITMQ_URL: "amqp://localhost:5672",
    });

    productionManager.load();

    expect(productionManager.getNodeEnvironment()).toBe("production");
    expect(productionManager.isProduction()).toBe(true);
    expect(productionManager.isDevelopment()).toBe(false);
    expect(productionManager.isTest()).toBe(false);

    const testManager = new EnvironmentManager();
    process.env = buildRequiredEnv({
      NODE_ENV: "test",
    });

    testManager.load();

    expect(testManager.getNodeEnvironment()).toBe("test");
    expect(testManager.isProduction()).toBe(false);
    expect(testManager.isDevelopment()).toBe(false);
    expect(testManager.isTest()).toBe(true);
  });

  it("returns cloned origin arrays so callers cannot mutate stored config", () => {
    process.env = buildRequiredEnv({
      CORS_ALLOWED_ORIGINS: "http://localhost:3041,http://localhost:3042",
      CSRF_ALLOWED_ORIGINS: "http://localhost:3041,http://localhost:3042",
    });

    const manager = new EnvironmentManager();
    const environment = manager.load();

    const corsOrigins = manager.getCorsAllowedOrigins();
    const csrfOrigins = manager.getCsrfAllowedOrigins();

    corsOrigins.push("http://localhost:3099");
    csrfOrigins.push("http://localhost:3099");

    expect(manager.getCorsAllowedOrigins()).toEqual(
      environment.cors.allowedOrigins,
    );
    expect(manager.getCsrfAllowedOrigins()).toEqual(
      environment.csrf.allowedOrigins,
    );
    expect(manager.getCorsAllowedOrigins()).not.toContain(
      "http://localhost:3099",
    );
    expect(manager.getCsrfAllowedOrigins()).not.toContain(
      "http://localhost:3099",
    );
  });

  it("reads required and optional raw environment variables after load", () => {
    process.env = buildRequiredEnv({
      FRONTEND_URL: "http://localhost:3041",
    });

    const manager = new EnvironmentManager();

    manager.load();

    expect(manager.getEnvironmentVariable("DATABASE_URL")).toBe(
      "mysql://process:process@localhost:3306/rent_process",
    );
    expect(manager.getOptionalEnvironmentVariable("FRONTEND_URL")).toBe(
      "http://localhost:3041",
    );
    expect(manager.getOptionalEnvironmentVariable("MISSING_OPTIONAL_KEY")).toBe(
      undefined,
    );
    expect(() =>
      manager.getEnvironmentVariable("MISSING_REQUIRED_KEY"),
    ).toThrow("Missing required environment variable: MISSING_REQUIRED_KEY");
  });
});
