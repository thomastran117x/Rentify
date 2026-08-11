import type { RequestHandler } from "express";
import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import { runAfterResponse } from "@/configuration/http/response-lifecycle";
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

export const requestTimeoutMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  const timeoutMs = readRequestTimeoutMs();

  // The Hono version raced next() against a rejecting timer. Express's next()
  // is not awaitable, so the timer instead pushes the error into the error
  // middleware itself, and is cleared once the response completes.
  const timer = setTimeout(() => {
    if (response.headersSent || response.writableEnded) {
      return;
    }

    next(
      new GatewayTimeoutError("Request timed out.", {
        requestId: request.requestId,
        timeoutMs,
      }),
    );
  }, timeoutMs);

  runAfterResponse(response, () => {
    clearTimeout(timer);
  });

  next();
};
