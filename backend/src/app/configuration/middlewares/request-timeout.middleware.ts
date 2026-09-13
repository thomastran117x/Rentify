import type { RequestHandler } from "express";
import { environment } from "@/configuration/environment";
import { runAfterResponse } from "@/configuration/http/response-lifecycle";
import GatewayTimeoutError from "@/errors/http/gateway-timeout.error";

function readRequestTimeoutMs(): number {
  return environment.getHttpConfig().requestTimeoutMs;
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
