import { createMiddleware } from "hono/factory";
import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import type { AppBindings } from "@/configuration/http/bindings";
import GatewayTimeoutError from "@/errors/http/gateway-timeout.error";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function readRequestTimeoutMs(): number {
  const configuredValue = getOptionalEnvironmentVariable("REQUEST_TIMEOUT_MS");

  if (!configuredValue) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const parsedValue = Number(configuredValue);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return parsedValue;
}

export const requestTimeoutMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    const timeoutMs = readRequestTimeoutMs();

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new GatewayTimeoutError("Request timed out.", {
                requestId: context.get("requestId"),
                timeoutMs,
              }),
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  },
);
