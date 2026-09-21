import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
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
    MFA_TOTP_ENCRYPTION_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    GMAIL_USER: "process@example.com",
    GMAIL_APP_PASSWORD: "process-password",
    PAYPAL_CLIENT_ID: "process-paypal-client-id",
    PAYPAL_CLIENT_SECRET: "process-paypal-client-secret",
    PAYPAL_WEBHOOK_ID: "process-paypal-webhook-id",
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
      MFA_BYPASS_EMAILS:
        "OWNER1@rentify.local,owner1@rentify.local,user1@rentify.local",
    });

    const manager = new EnvironmentManager();
    const environment = manager.load();

    expect(manager.get()).toBe(environment);
    expect(manager.getNodeEnvironment()).toBe("development");
    expect(manager.isProduction()).toBe(false);
    expect(manager.isDevelopment()).toBe(true);
    expect(manager.isTest()).toBe(false);
    expect(manager.getServerPort()).toBe(environment.server.port);
    expect(manager.getApplicationConfig()).toBe(environment.application);
    expect(manager.getHttpConfig()).toBe(environment.http);
    expect(manager.getTokenConfig()).toBe(environment.auth);
    expect(manager.getDatabaseConfig()).toBe(environment.database);
    expect(manager.getEmailConfig()).toBe(environment.email);
    expect(manager.getSmsConfig()).toBe(environment.sms);
    expect(manager.getCaptchaConfig()).toBe(environment.captcha);
    expect(manager.getGoogleOAuthConfig()).toBe(environment.oauth.google);
    expect(manager.getMicrosoftOAuthConfig()).toBe(environment.oauth.microsoft);
    expect(manager.getAppleOAuthConfig()).toBe(environment.oauth.apple);
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
    expect(manager.getMediaProcessingWorkerConfig()).toBe(
      environment.workers.mediaProcessing,
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
    expect(manager.getFeaturesConfig()).toBe(environment.features);
    expect(manager.getRabbitMqConfig()).toBe(environment.rabbitmq);
    expect(manager.getElasticsearchConfig()).toBe(environment.elasticsearch);
    expect(manager.getPayPalConfig()).toBe(environment.paypal);
    expect(environment.auth.mfaBypassEmails).toEqual([
      "owner1@rentify.local",
      "user1@rentify.local",
    ]);
  });

  it("fails environment validation when MFA_BYPASS_EMAILS contains an invalid email", () => {
    process.env = buildRequiredEnv({
      MFA_BYPASS_EMAILS: "owner1@rentify.local,not-an-email",
    });

    const manager = new EnvironmentManager();

    expect(() => manager.load()).toThrow(
      "MFA_BYPASS_EMAILS contains an invalid email: not-an-email.",
    );
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
    expect(testManager.getLoggingConfig().silent).toBe(true);

    const loggingOverrideManager = new EnvironmentManager();
    process.env = buildRequiredEnv({
      NODE_ENV: "test",
      LOG_SILENT: "false",
    });

    loggingOverrideManager.load();

    expect(loggingOverrideManager.getLoggingConfig().silent).toBe(false);
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

  it("loads default, profile, and custom YAML layers before env overrides", () => {
    writeFileSync(
      join(tempDirectory, "default.yml"),
      'variables:\n  frontendOrigin: http://default.test\nserver:\n  port: 8000\napplication:\n  frontendUrl: "${config.frontendOrigin}"\ncors:\n  allowedOrigins: [http://default.test]\nfeatures:\n  layered:\n    enabled: false\n',
    );
    writeFileSync(
      join(tempDirectory, "development.yml"),
      "variables:\n  frontendOrigin: http://profile.test\nserver:\n  port: 8100\ncors:\n  allowedOrigins: [http://profile.test]\n",
    );
    const overlayPath = join(tempDirectory, "custom.yml");
    writeFileSync(
      overlayPath,
      "variables:\n  frontendOrigin: http://overlay.test\nserver:\n  port: 8200\ncors:\n  allowedOrigins: [http://overlay.test]\n",
    );
    process.env = buildRequiredEnv({
      PORT: "8300",
      CORS_ALLOWED_ORIGINS: "http://environment.test",
    });

    const manager = new EnvironmentManager({
      configurationDirectory: tempDirectory,
      configurationFilePath: overlayPath,
    });
    const loaded = manager.load();

    expect(loaded.server.port).toBe(8300);
    expect(loaded.application.frontendUrl).toBe("http://overlay.test");
    expect(loaded.cors.allowedOrigins).toEqual(["http://environment.test"]);
    expect(loaded.features.layered).toEqual({
      enabled: false,
      source: "config",
    });
  });

  it("preserves legacy fallbacks when optional YAML values are omitted", () => {
    process.env = buildRequiredEnv({
      CORS_ALLOWED_ORIGINS: "https://rentify.example,https://partner.example",
      GMAIL_USER: "mailer@rentify.example",
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-client-secret",
      APPLE_OAUTH_CLIENT_ID: "com.rentify.web",
      APPLE_OAUTH_TEAM_ID: "TEAM123456",
      APPLE_OAUTH_KEY_ID: "KEY1234567",
      APPLE_OAUTH_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    });

    const loaded = new EnvironmentManager().load();

    expect(loaded.csrf.allowedOrigins).toEqual([
      "https://rentify.example",
      "https://partner.example",
    ]);
    expect(loaded.email.fromEmail).toBe("mailer@rentify.example");
    expect(loaded.oauth.google.audiences).toEqual(["google-client-id"]);
    expect(loaded.oauth.microsoft.audiences).toEqual(["microsoft-client-id"]);
    expect(loaded.oauth.apple).toMatchObject({
      audiences: ["com.rentify.web"],
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    });
  });

  it("rejects an Apple private key without the rest of the Apple signing config", () => {
    process.env = buildRequiredEnv({
      APPLE_OAUTH_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
      APPLE_OAUTH_CLIENT_ID: "com.rentify.web",
    });
    const manager = new EnvironmentManager();

    expect(() => manager.load()).toThrow(
      "APPLE_OAUTH_PRIVATE_KEY requires APPLE_OAUTH_CLIENT_ID (or APPLE_OAUTH_CLIENT_IDS), APPLE_OAUTH_TEAM_ID, and APPLE_OAUTH_KEY_ID.",
    );
  });

  it("resolves a relative custom YAML path from the configuration directory", () => {
    writeFileSync(
      join(tempDirectory, "default.yml"),
      "server:\n  port: 8000\n",
    );
    writeFileSync(join(tempDirectory, "test.yml"), "server:\n  port: 8100\n");
    writeFileSync(join(tempDirectory, "local.yml"), "server:\n  port: 8200\n");
    process.env = buildRequiredEnv({
      NODE_ENV: "test",
      BACKEND_CONFIG_FILE: "local.yml",
    });

    const manager = new EnvironmentManager({
      configurationDirectory: tempDirectory,
    });

    expect(manager.load().server.port).toBe(8200);
  });

  it("fails with the missing profile path in the error", () => {
    writeFileSync(
      join(tempDirectory, "default.yml"),
      "server:\n  port: 8000\n",
    );
    process.env = buildRequiredEnv({ NODE_ENV: "test" });
    const manager = new EnvironmentManager({
      configurationDirectory: tempDirectory,
    });

    expect(() => manager.load()).toThrow(join(tempDirectory, "test.yml"));
  });

  it("fails with the missing custom overlay path in the error", () => {
    writeFileSync(
      join(tempDirectory, "default.yml"),
      "server:\n  port: 8000\n",
    );
    writeFileSync(join(tempDirectory, "test.yml"), "server:\n  port: 8100\n");
    process.env = buildRequiredEnv({
      NODE_ENV: "test",
      BACKEND_CONFIG_FILE: "missing.yml",
    });
    const manager = new EnvironmentManager({
      configurationDirectory: tempDirectory,
    });

    expect(() => manager.load()).toThrow(join(tempDirectory, "missing.yml"));
  });

  it("fails when a required environment-only secret is missing", () => {
    process.env = buildRequiredEnv({ ACCESS_TOKEN_SECRET: undefined });
    const manager = new EnvironmentManager();

    expect(() => manager.load()).toThrow(
      "ACCESS_TOKEN_SECRET is required when using HS256.",
    );
  });

  it("loads RS256 access-token credentials without an HMAC secret", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    process.env = buildRequiredEnv({
      ACCESS_TOKEN_ALGORITHM: "RS256",
      ACCESS_TOKEN_SECRET: undefined,
      ACCESS_TOKEN_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"),
      ACCESS_TOKEN_PUBLIC_KEY: publicKey.replace(/\n/g, "\\n"),
    });
    const manager = new EnvironmentManager();

    const tokenConfig = manager.load().auth;

    expect(tokenConfig).toMatchObject({
      accessTokenAlgorithm: "RS256",
      accessTokenSecret: undefined,
      accessTokenPrivateKey: privateKey,
      accessTokenPublicKey: publicKey,
    });
  });

  it("rejects RS256 access-token credentials that do not form a key pair", () => {
    const firstPair = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    const secondPair = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    process.env = buildRequiredEnv({
      ACCESS_TOKEN_ALGORITHM: "RS256",
      ACCESS_TOKEN_SECRET: undefined,
      ACCESS_TOKEN_PRIVATE_KEY: firstPair.privateKey,
      ACCESS_TOKEN_PUBLIC_KEY: secondPair.publicKey,
    });
    const manager = new EnvironmentManager();

    expect(() => manager.load()).toThrow(
      "ACCESS_TOKEN_PRIVATE_KEY and ACCESS_TOKEN_PUBLIC_KEY must form a matching RSA key pair.",
    );
  });

  it("validates cross-field and bounded values after layering", () => {
    process.env = buildRequiredEnv({
      AZURE_STORAGE_CONNECTION_STRING:
        "DefaultEndpointsProtocol=https;AccountName=rent;AccountKey=key",
      AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS: "59",
    });
    const manager = new EnvironmentManager();

    expect(() => manager.load()).toThrow(
      "AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER_NAME must be configured together.",
    );

    process.env.AZURE_STORAGE_CONTAINER_NAME = "uploads";
    const boundedManager = new EnvironmentManager();
    expect(() => boundedManager.load()).toThrow(
      "AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS must be greater than or equal to 60.",
    );
  });

  it("defaults the image upload policy and allows narrowing it", () => {
    process.env = buildRequiredEnv({});
    const defaultManager = new EnvironmentManager();
    defaultManager.load();

    expect(defaultManager.getImageUploadsConfig()).toEqual({
      allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
      maxSizeBytes: 5 * 1024 * 1024,
      maxWidth: 8_000,
      maxHeight: 8_000,
      maxPixels: 40_000_000,
    });

    process.env = buildRequiredEnv({
      ALLOWED_IMAGE_TYPES: "image/png, IMAGE/WEBP",
    });
    const narrowedManager = new EnvironmentManager();
    narrowedManager.load();

    expect(narrowedManager.getImageUploadsConfig().allowedContentTypes).toEqual(
      ["image/png", "image/webp"],
    );
  });

  it("rejects image policy values outside the supported set or bounds", () => {
    process.env = buildRequiredEnv({
      ALLOWED_IMAGE_TYPES: "image/svg+xml",
    });

    expect(() => new EnvironmentManager().load()).toThrow(
      "ALLOWED_IMAGE_TYPES contains unsupported value image/svg+xml.",
    );

    process.env = buildRequiredEnv({ MAX_IMAGE_SIZE_BYTES: "0" });

    expect(() => new EnvironmentManager().load()).toThrow(
      "MAX_IMAGE_SIZE_BYTES must be greater than or equal to 1.",
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
