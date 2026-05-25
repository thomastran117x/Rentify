import { Prisma, type PrismaClient } from "@prisma/client";
import {
  getDatabaseClient,
  type databaseClient,
} from "@/configuration/resources/database";
import { environment } from "@/configuration/environment/index";
import { loggerFactory, type Logger } from "@/configuration/logging";

type DatabaseClient = NonNullable<typeof databaseClient>;
type TransactionClient = Prisma.TransactionClient;

export interface RetryOptions {
  backoffMultiplier?: number;
  deadlineMs?: number;
  initialDelayMs?: number;
  jitterMs?: number;
  maxDelayMs?: number;
  maxRetries?: number;
  retryableCodes?: string[];
}

export interface RepositoryOperationOptions extends RetryOptions {
  operationName?: string;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  backoffMultiplier: 2,
  deadlineMs: 10_000,
  initialDelayMs: 100,
  jitterMs: 50,
  maxDelayMs: 2_000,
  maxRetries: 3,
  retryableCodes: ["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"],
};

const TRANSIENT_ERROR_NAMES = new Set([
  "AbortError",
  "PrismaClientInitializationError",
  "PrismaClientRustPanicError",
  "PrismaClientUnknownRequestError",
]);

const TRANSIENT_NODE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "PROTOCOL_CONNECTION_LOST",
]);

export abstract class BaseRepository {
  protected readonly database: DatabaseClient;
  private readonly logger: Logger;

  constructor(database: DatabaseClient = getDatabaseClient()) {
    this.database = database;
    this.logger = loggerFactory.forClass(
      this.constructor.name || "BaseRepository",
      "repository",
    );
  }

  protected async executeAsync<T>(
    operation: () => Promise<T>,
    options: RepositoryOperationOptions = {},
  ): Promise<T> {
    const settings = {
      ...DEFAULT_RETRY_OPTIONS,
      ...options,
    };
    const operationName = this.createOperationName(options.operationName);
    const startedAt = performance.now();
    const deadlineStartedAt = Date.now();

    let attempt = 0;
    let lastError: unknown;
    let succeeded = false;

    try {
      while (attempt <= settings.maxRetries) {
        try {
          const result = await operation();
          succeeded = true;
          return result;
        } catch (error) {
          lastError = error;

          if (
            attempt === settings.maxRetries ||
            !this.isTransientError(error, settings) ||
            this.hasReachedDeadline(deadlineStartedAt, settings)
          ) {
            throw error;
          }

          const delayMs = this.calculateDelay(attempt, settings);

          if (this.willExceedDeadline(deadlineStartedAt, delayMs, settings)) {
            throw error;
          }

          this.logRetry(operationName, attempt + 1, delayMs, error);
          await this.sleep(delayMs);
          attempt += 1;
        }
      }
    } finally {
      this.logOperationDuration(
        operationName,
        startedAt,
        succeeded,
        attempt,
        lastError,
      );
    }

    throw lastError;
  }

  protected async executeTransaction<T>(
    operation: (transaction: TransactionClient) => Promise<T>,
    options: RepositoryOperationOptions = {},
  ): Promise<T> {
    return this.executeAsync(
      () => this.prisma.$transaction((transaction) => operation(transaction)),
      {
        ...options,
        operationName: options.operationName ?? "transaction",
      },
    );
  }

  protected get prisma(): PrismaClient {
    return this.database;
  }

  private createOperationName(operationName?: string): string {
    const repositoryName = this.constructor.name || "Repository";

    if (!operationName) {
      return `${repositoryName}.operation`;
    }

    if (operationName.includes(".")) {
      return operationName;
    }

    return `${repositoryName}.${operationName}`;
  }

  private logRetry(
    operationName: string,
    attempt: number,
    delayMs: number,
    error: unknown,
  ): void {
    this.logger.warn("Database operation retry scheduled.", {
      attempt,
      delayMs,
      errorCode: this.readErrorCode(error) ?? "unknown",
      errorName: this.readErrorName(error),
      message: this.readErrorMessage(error),
      operation: operationName,
    });
  }

  private logOperationDuration(
    operationName: string,
    startedAt: number,
    succeeded: boolean,
    attempts: number,
    error: unknown,
  ): void {
    const config = environment.getDatabaseConfig();
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const shouldLogOperation = config.operationLoggingEnabled;
    const shouldLogSlowOperation =
      config.slowOperationThresholdMs > 0 &&
      durationMs >= config.slowOperationThresholdMs;

    if (!shouldLogOperation && !shouldLogSlowOperation && succeeded) {
      return;
    }

    const logMethod =
      succeeded && !shouldLogSlowOperation
        ? this.logger.info.bind(this.logger)
        : this.logger.warn.bind(this.logger);

    logMethod("Database operation completed.", {
      attempts: attempts + 1,
      durationMs,
      errorCode: succeeded
        ? undefined
        : (this.readErrorCode(error) ?? "unknown"),
      errorName: succeeded ? undefined : this.readErrorName(error),
      message: succeeded ? undefined : this.readErrorMessage(error),
      operation: operationName,
      slow: shouldLogSlowOperation,
      status: succeeded ? "success" : "failure",
    });
  }

  private isTransientError(
    error: unknown,
    options: Required<RetryOptions>,
  ): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return options.retryableCodes.includes(error.code);
    }

    if (
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientRustPanicError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      return true;
    }

    if (error instanceof Error && TRANSIENT_ERROR_NAMES.has(error.name)) {
      return true;
    }

    const errorCode = this.readErrorCode(error);

    if (!errorCode) {
      return false;
    }

    return TRANSIENT_NODE_ERROR_CODES.has(errorCode);
  }

  private readErrorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return undefined;
    }

    const { code } = error as { code?: unknown };
    return typeof code === "string" ? code : undefined;
  }

  private readErrorName(error: unknown): string {
    return error instanceof Error ? error.name : "UnknownError";
  }

  private readErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown database error.";
  }

  private calculateDelay(
    attempt: number,
    options: Required<RetryOptions>,
  ): number {
    const exponentialDelay = Math.min(
      options.initialDelayMs * options.backoffMultiplier ** attempt,
      options.maxDelayMs,
    );
    const jitter = Math.floor(Math.random() * options.jitterMs);

    return exponentialDelay + jitter;
  }

  private hasReachedDeadline(
    startedAt: number,
    options: Required<RetryOptions>,
  ): boolean {
    return Date.now() - startedAt >= options.deadlineMs;
  }

  private willExceedDeadline(
    startedAt: number,
    nextDelayMs: number,
    options: Required<RetryOptions>,
  ): boolean {
    return Date.now() - startedAt + nextDelayMs >= options.deadlineMs;
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }
}
