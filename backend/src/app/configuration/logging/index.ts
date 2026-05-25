import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { environment } from "@/configuration/environment";
import { ApplicationLogQueueService } from "@/configuration/logging/log-queue.service";
import { formatPrettyLogEvent } from "@/configuration/logging/pretty";
import type {
  LogContext,
  LogEvent,
  LogLayer,
  LogLevel,
  Logger,
  LoggerFactory,
  NormalizedLogError,
} from "@/configuration/logging/types";

interface LoggingRuntimeConfig {
  environment: string;
  fallbackDirectory: string;
  level: LogLevel;
  mode: "console" | "rabbitmq";
  rabbitMqUrl?: string;
  serviceName: string;
}

type PendingLogEvent = Pick<LogEvent, "level" | "message"> &
  Partial<
    Omit<
      LogEvent,
      "environment" | "level" | "message" | "runtime" | "service" | "timestamp"
    >
  > & {
    timestamp?: string;
  };

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  critical: 50,
};

const DEFAULT_FALLBACK_FILENAME = "application.log.jsonl";
const DEFAULT_FALLBACK_DIRECTORY = "/app/logs/fallback";
const DEFAULT_SERVICE_NAME = "backend";
const RESERVED_EVENT_FIELD_NAMES = new Set([
  "component",
  "correlationId",
  "error",
  "fields",
  "layer",
  "message",
  "queue",
  "requestId",
  "service",
  "timestamp",
  "workerName",
]);

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error" ||
    normalized === "critical"
  ) {
    return normalized;
  }

  return "info";
}

function normalizeNodeEnvironment(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "production" ||
    normalized === "test" ||
    normalized === "development"
  ) {
    return normalized;
  }

  return "development";
}

function getRuntimeLoggingConfig(): LoggingRuntimeConfig {
  try {
    const logging = environment.getLoggingConfig();
    const rabbitMq = environment.getRabbitMqConfig();

    return {
      environment: environment.getNodeEnvironment(),
      fallbackDirectory: logging.fallbackDirectory,
      level: logging.level,
      mode: logging.mode,
      rabbitMqUrl: rabbitMq.url,
      serviceName: logging.serviceName,
    };
  } catch {
    const nodeEnv = normalizeNodeEnvironment(process.env.NODE_ENV);

    return {
      environment: nodeEnv,
      fallbackDirectory:
        process.env.LOG_FALLBACK_DIRECTORY?.trim() ||
        DEFAULT_FALLBACK_DIRECTORY,
      level: parseLogLevel(process.env.LOG_LEVEL),
      mode: nodeEnv === "production" ? "rabbitmq" : "console",
      rabbitMqUrl: process.env.RABBITMQ_URL?.trim() || undefined,
      serviceName: process.env.LOG_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
    };
  }
}

function shouldLog(eventLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[eventLevel] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pruneUndefinedEntries<TValue extends Record<string, unknown>>(
  value: TValue,
): TValue {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TValue;
}

function normalizeFields(
  fields?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!fields) {
    return undefined;
  }

  const filteredEntries = Object.entries(fields).filter(([key, value]) => {
    return value !== undefined && !RESERVED_EVENT_FIELD_NAMES.has(key);
  });

  if (filteredEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(filteredEntries);
}

function mergeContext(base: LogContext, next: LogContext): LogContext {
  return pruneUndefinedEntries({
    layer: next.layer ?? base.layer,
    component: next.component ?? base.component,
    requestId: next.requestId ?? base.requestId,
    workerName: next.workerName ?? base.workerName,
    queue: next.queue ?? base.queue,
    correlationId: next.correlationId ?? base.correlationId,
    fields: normalizeFields({
      ...(base.fields ?? {}),
      ...(next.fields ?? {}),
    }),
  });
}

function normalizeError(error: unknown): NormalizedLogError {
  if (error instanceof Error) {
    const details = isPlainObject(error)
      ? pruneUndefinedEntries(
          Object.fromEntries(
            Object.entries(error).filter(
              ([key]) => !["message", "name", "stack"].includes(key),
            ),
          ) as Record<string, unknown>,
        )
      : undefined;

    return pruneUndefinedEntries({
      name: error.name || "Error",
      message: error.message || "Unknown error.",
      stack: error.stack,
      details: details && Object.keys(details).length > 0 ? details : undefined,
    });
  }

  if (isPlainObject(error)) {
    return {
      name: typeof error.name === "string" ? error.name : "UnknownError",
      message:
        typeof error.message === "string"
          ? error.message
          : "Unknown non-Error failure payload.",
      details: pruneUndefinedEntries({ ...error }),
    };
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? error : "Unknown error.",
  };
}

class PrettyTerminalWriter {
  async write(event: LogEvent): Promise<void> {
    const line = `${formatPrettyLogEvent(event)}\n`;
    const stream =
      event.level === "error" || event.level === "critical"
        ? process.stderr
        : process.stdout;

    await new Promise<void>((resolve, reject) => {
      stream.write(line, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

class JsonlFallbackFileWriter {
  constructor(private readonly fallbackDirectory: string) {}

  async write(event: LogEvent): Promise<void> {
    await mkdir(this.fallbackDirectory, {
      recursive: true,
    });
    await appendFile(
      path.join(this.fallbackDirectory, DEFAULT_FALLBACK_FILENAME),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
  }
}

class BestEffortLogDispatcher {
  private readonly consoleWriter = new PrettyTerminalWriter();
  private readonly queueService = new ApplicationLogQueueService();
  private fallbackFileWriterCache = new Map<string, JsonlFallbackFileWriter>();

  dispatch(event: PendingLogEvent): void {
    const config = getRuntimeLoggingConfig();
    const finalizedEvent = this.finalizeEvent(event, config);

    if (!shouldLog(finalizedEvent.level, config.level)) {
      return;
    }

    void this.writeBestEffort(finalizedEvent, config);
  }

  async disconnect(): Promise<void> {
    await this.queueService.disconnect();
  }

  private finalizeEvent(
    event: PendingLogEvent,
    config: LoggingRuntimeConfig,
  ): LogEvent {
    return pruneUndefinedEntries({
      ...event,
      component: event.component || "root",
      environment: config.environment,
      layer: event.layer || "app",
      runtime: "node" as const,
      service: config.serviceName,
      timestamp: event.timestamp ?? new Date().toISOString(),
    });
  }

  private async writeBestEffort(
    event: LogEvent,
    config: LoggingRuntimeConfig,
  ): Promise<void> {
    if (config.mode === "console") {
      try {
        await this.consoleWriter.write(event);
      } catch (error) {
        this.emitLoggingFailure(event, error);
      }

      return;
    }

    try {
      await this.queueService.publishLogEvent(event);
    } catch (primaryError) {
      try {
        await this.getFallbackFileWriter(config.fallbackDirectory).write(event);
      } catch (fallbackError) {
        this.emitLoggingFailure(event, primaryError, fallbackError);
      }
    }
  }

  private getFallbackFileWriter(
    fallbackDirectory: string,
  ): JsonlFallbackFileWriter {
    const existingWriter = this.fallbackFileWriterCache.get(fallbackDirectory);

    if (existingWriter) {
      return existingWriter;
    }

    const writer = new JsonlFallbackFileWriter(fallbackDirectory);
    this.fallbackFileWriterCache.set(fallbackDirectory, writer);
    return writer;
  }

  private emitLoggingFailure(
    originalEvent: LogEvent,
    primaryError: unknown,
    fallbackError?: unknown,
  ): void {
    console.error("[LOGGER FAILURE] Failed to persist log event.", {
      originalEvent: {
        component: originalEvent.component,
        level: originalEvent.level,
        message: originalEvent.message,
      },
      primaryError: normalizeError(primaryError),
      ...(fallbackError
        ? { fallbackError: normalizeError(fallbackError) }
        : {}),
    });
  }
}

class LoggerImpl implements Logger {
  constructor(
    private readonly dispatcher: BestEffortLogDispatcher,
    private readonly context: LogContext,
  ) {}

  debug(message: string, fields?: Record<string, unknown>): void {
    this.log("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.log("info", message, fields);
  }

  warn(
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown,
  ): void {
    this.log("warn", message, fields, error);
  }

  error(
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown,
  ): void {
    this.log("error", message, fields, error);
  }

  critical(
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown,
  ): void {
    this.log("critical", message, fields, error);
  }

  child(context: LogContext): Logger {
    return new LoggerImpl(this.dispatcher, mergeContext(this.context, context));
  }

  private log(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown,
  ): void {
    this.dispatcher.dispatch(
      pruneUndefinedEntries({
        component: this.context.component,
        correlationId: this.context.correlationId,
        error: error === undefined ? undefined : normalizeError(error),
        fields: normalizeFields({
          ...(this.context.fields ?? {}),
          ...(fields ?? {}),
        }),
        layer: this.context.layer,
        level,
        message,
        queue: this.context.queue,
        requestId: this.context.requestId,
        workerName: this.context.workerName,
      }),
    );
  }
}

class DefaultLoggerFactory implements LoggerFactory {
  constructor(private readonly dispatcher: BestEffortLogDispatcher) {}

  forClass(target: Function | string, layer: LogLayer): Logger {
    const component =
      typeof target === "string" ? target.trim() : target.name?.trim();

    return new LoggerImpl(this.dispatcher, {
      component: component || "anonymous",
      layer,
    });
  }

  forComponent(component: string, layer: LogLayer): Logger {
    return new LoggerImpl(this.dispatcher, {
      component: component.trim() || "anonymous",
      layer,
    });
  }

  fromContext(base: Logger, context: LogContext): Logger {
    return base.child(context);
  }
}

const dispatcher = new BestEffortLogDispatcher();

export const loggerFactory: LoggerFactory = new DefaultLoggerFactory(
  dispatcher,
);
export const logger = loggerFactory.forComponent("root", "app");
export default logger;

export async function disconnectLogging(): Promise<void> {
  await dispatcher.disconnect();
}

export { ApplicationLogQueueService };
export type {
  LogContext,
  LogEvent,
  LogLayer,
  LogLevel,
  Logger,
  LoggerFactory,
  NormalizedLogError,
};
