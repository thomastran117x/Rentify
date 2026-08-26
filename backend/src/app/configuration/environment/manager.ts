import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { parseEnvironmentState } from "@/configuration/environment/parser";
import type {
  AppEnvironment,
  EnvironmentState,
  NodeEnvironment,
} from "@/configuration/environment/types";

function resolveDefaultEnvFilePath(): string | undefined {
  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "backend/.env"),
  ];

  return candidatePaths.find((candidatePath) => existsSync(candidatePath));
}

type EnvironmentManagerOptions = {
  envFilePath?: string;
};

export class EnvironmentManager {
  private isLoaded = false;
  private state: EnvironmentState | null = null;

  constructor(private readonly options: EnvironmentManagerOptions = {}) {}

  load(): AppEnvironment {
    if (this.state) {
      return this.state.config;
    }

    if (!this.isLoaded) {
      const envFilePath =
        this.options.envFilePath ?? resolveDefaultEnvFilePath();

      if (envFilePath && existsSync(envFilePath)) {
        config({
          path: envFilePath,
          override: false,
        });
      }

      this.isLoaded = true;
    }

    this.state = parseEnvironmentState(process.env);
    return this.state.config;
  }

  get(): AppEnvironment {
    if (!this.state) {
      throw new Error(
        "Environment has not been loaded. Call loadEnvironment() during application startup first.",
      );
    }

    return this.state.config;
  }

  getNodeEnvironment(): NodeEnvironment {
    return this.get().server.nodeEnv;
  }

  isProduction(): boolean {
    return this.get().server.isProduction;
  }

  isDevelopment(): boolean {
    return this.get().server.nodeEnv === "development";
  }

  isTest(): boolean {
    return this.get().server.nodeEnv === "test";
  }

  getServerPort(): number {
    return this.get().server.port;
  }

  getTokenConfig(): AppEnvironment["auth"] {
    return this.get().auth;
  }

  getDatabaseConfig(): AppEnvironment["database"] {
    return this.get().database;
  }

  getEmailConfig(): AppEnvironment["email"] {
    return this.get().email;
  }

  getSmsConfig(): AppEnvironment["sms"] {
    return this.get().sms;
  }

  getCaptchaConfig(): AppEnvironment["captcha"] {
    return this.get().captcha;
  }

  getCorsAllowedOrigins(): string[] {
    return [...this.get().cors.allowedOrigins];
  }

  getCsrfAllowedOrigins(): string[] {
    return [...this.get().csrf.allowedOrigins];
  }

  getGoogleOAuthConfig(): AppEnvironment["oauth"]["google"] {
    return this.get().oauth.google;
  }

  getMicrosoftOAuthConfig(): AppEnvironment["oauth"]["microsoft"] {
    return this.get().oauth.microsoft;
  }

  getRedisConfig(): AppEnvironment["redis"] {
    return this.get().redis;
  }

  getRateLimiterConfig(): AppEnvironment["rateLimiter"] {
    return this.get().rateLimiter;
  }

  getSearchWorkerConfig(): AppEnvironment["workers"]["search"] {
    return this.get().workers.search;
  }

  getSearchRelayWorkerConfig(): AppEnvironment["workers"]["searchRelay"] {
    return this.get().workers.searchRelay;
  }

  getSearchIndexerWorkerConfig(): AppEnvironment["workers"]["searchIndexer"] {
    return this.get().workers.searchIndexer;
  }

  getSearchReconcileWorkerConfig(): AppEnvironment["workers"]["searchReconcile"] {
    return this.get().workers.searchReconcile;
  }

  getSearchReindexWorkerConfig(): AppEnvironment["workers"]["searchReindex"] {
    return this.get().workers.searchReindex;
  }

  getEmailWorkerConfig(): AppEnvironment["workers"]["email"] {
    return this.get().workers.email;
  }

  getSmsWorkerConfig(): AppEnvironment["workers"]["sms"] {
    return this.get().workers.sms;
  }

  getAnalyticsWorkerConfig(): AppEnvironment["workers"]["analytics"] {
    return this.get().workers.analytics;
  }

  getRecommendationsPrecomputeWorkerConfig(): AppEnvironment["workers"]["recommendationsPrecompute"] {
    return this.get().workers.recommendationsPrecompute;
  }

  getPostingsThumbnailWorkerConfig(): AppEnvironment["workers"]["postingsThumbnail"] {
    return this.get().workers.postingsThumbnail;
  }

  getBookingExpiryWorkerConfig(): AppEnvironment["workers"]["bookingExpiry"] {
    return this.get().workers.bookingExpiry;
  }

  getPostingExpiryWorkerConfig(): AppEnvironment["workers"]["postingExpiry"] {
    return this.get().workers.postingExpiry;
  }

  getSavedSearchAlertWorkerConfig(): AppEnvironment["workers"]["savedSearchAlert"] {
    return this.get().workers.savedSearchAlert;
  }

  getPaymentsRetryWorkerConfig(): AppEnvironment["workers"]["paymentsRetry"] {
    return this.get().workers.paymentsRetry;
  }

  getPaymentsRepairWorkerConfig(): AppEnvironment["workers"]["paymentsRepair"] {
    return this.get().workers.paymentsRepair;
  }

  getPayoutReleaseWorkerConfig(): AppEnvironment["workers"]["payoutRelease"] {
    return this.get().workers.payoutRelease;
  }

  getPostingsPublicCacheConfig(): AppEnvironment["postingsCache"] {
    return this.get().postingsCache;
  }

  getUsernameBloomConfig(): AppEnvironment["usernameBloom"] {
    return this.get().usernameBloom;
  }

  getBlobStorageConfig(): AppEnvironment["blobStorage"] {
    return this.get().blobStorage;
  }

  getLoggingConfig(): AppEnvironment["logging"] {
    return this.get().logging;
  }

  getRouteModulesConfig(): AppEnvironment["routeModules"] {
    return this.get().routeModules;
  }

  getFeaturesConfig(): AppEnvironment["features"] {
    return this.get().features;
  }

  getRabbitMqConfig(): AppEnvironment["rabbitmq"] {
    return this.get().rabbitmq;
  }

  getElasticsearchConfig(): AppEnvironment["elasticsearch"] {
    return this.get().elasticsearch;
  }

  getSquareConfig(): AppEnvironment["square"] {
    return this.get().square;
  }

  getEnvironmentVariable(name: string): string {
    const value = (
      this.state?.raw as Record<string, string | undefined> | undefined
    )?.[name];

    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
  }

  getOptionalEnvironmentVariable(name: string): string | undefined {
    return (
      this.state?.raw as Record<string, string | undefined> | undefined
    )?.[name];
  }
}

export const environment = new EnvironmentManager();

export function loadEnvironment(): AppEnvironment {
  return environment.load();
}

export function getEnvironment(): AppEnvironment {
  return environment.get();
}

export function getEnvironmentVariable(name: string): string {
  return environment.getEnvironmentVariable(name);
}

export function getOptionalEnvironmentVariable(
  name: string,
): string | undefined {
  return environment.getOptionalEnvironmentVariable(name);
}
