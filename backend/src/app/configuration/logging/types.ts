export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

export type LogLayer =
  | "app"
  | "controller"
  | "service"
  | "repository"
  | "worker"
  | "middleware"
  | "resource"
  | "script"
  | "queue"
  | "seed"
  | "request";

export interface NormalizedLogError {
  name: string;
  message: string;
  stack?: string;
  details?: Record<string, unknown>;
}

export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  environment: string;
  runtime: "node";
  layer: LogLayer;
  component: string;
  requestId?: string;
  workerName?: string;
  queue?: string;
  correlationId?: string;
  fields?: Record<string, unknown>;
  error?: NormalizedLogError;
}

export interface LogContext {
  layer?: LogLayer;
  component?: string;
  requestId?: string;
  workerName?: string;
  queue?: string;
  correlationId?: string;
  fields?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown,
  ): void;
  error(
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown,
  ): void;
  critical(
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown,
  ): void;
  child(context: LogContext): Logger;
}

export interface LoggerFactory {
  forClass(target: Function | string, layer: LogLayer): Logger;
  forComponent(component: string, layer: LogLayer): Logger;
  fromContext(base: Logger, context: LogContext): Logger;
}
