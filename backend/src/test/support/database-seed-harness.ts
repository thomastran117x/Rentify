import { loadEnvironment } from "@/configuration/environment";
import {
  connectDatabase,
  disconnectDatabase,
} from "@/configuration/resources/database";
import { runSeedOrchestrator } from "@/seeds/orchestrator";

const DEFAULT_DB_URL = "mysql://rent:rent@127.0.0.1:3307/rent";

export function applyDatabaseSeedTestEnvironment(
  overrides: {
    databaseUrl?: string;
  } = {},
): void {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL =
    overrides.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  process.env.DATABASE_AUTO_SEED_ENABLED = "true";
  process.env.DATABASE_AUTO_SEED_REFRESH = "true";
  process.env.ACCESS_TOKEN_SECRET =
    process.env.ACCESS_TOKEN_SECRET ?? "seed-test-access-secret-value-32ch";
  process.env.REFRESH_TOKEN_SECRET =
    process.env.REFRESH_TOKEN_SECRET ?? "seed-test-refresh-secret-value-32c";
  process.env.PERSONAL_ACCESS_TOKEN_SECRET =
    process.env.PERSONAL_ACCESS_TOKEN_SECRET ??
    "seed-test-personal-access-token-32";
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
  process.env.ELASTICSEARCH_ENABLED =
    process.env.ELASTICSEARCH_ENABLED ?? "false";
  process.env.RABBITMQ_URL = process.env.RABBITMQ_URL ?? "";
  process.env.FRONTEND_URL =
    process.env.FRONTEND_URL ?? "http://localhost:3040";
  process.env.APP_BASE_URL =
    process.env.APP_BASE_URL ?? "http://localhost:3040";
}

export async function bootstrapSeedTestDatabase(
  overrides: {
    databaseUrl?: string;
  } = {},
): Promise<void> {
  applyDatabaseSeedTestEnvironment(overrides);
  loadEnvironment();
  await connectDatabase();
  await runSeedOrchestrator({
    refresh: true,
    source: "test",
  });
}

export async function teardownSeedTestDatabase(): Promise<void> {
  await disconnectDatabase();
}
