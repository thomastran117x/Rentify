import express, { type Express } from "express";
import { mountRoutes } from "@/configuration/bootstrap/routes";
import { getApiRoutePrefix } from "@/configuration/http/api-path";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { clientContextMiddleware } from "../middlewares/client-context.middleware";
import { containerScopeMiddleware } from "../middlewares/container-scope.middleware";
import { corsMiddleware } from "../middlewares/cors.middleware";
import { csrfMiddleware } from "../middlewares/csrf.middleware";
import { handleApplicationError } from "../middlewares/error-handler.middleware";
import { httpLoggingMiddleware } from "../middlewares/http-logging.middleware";
import { idempotencyMiddleware } from "../middlewares/idempotency.middleware";
import { outputFormatMiddleware } from "../middlewares/output-format.middleware";
import { rateLimiterMiddleware } from "../middlewares/rate-limiter.middleware";
import {
  readRequestBodyMaxBytes,
  requestBodyPolicyMiddleware,
} from "../middlewares/request-body-policy.middleware";
import { requestIdMiddleware } from "../middlewares/request-id.middleware";
import { requestLoggerMiddleware } from "../middlewares/request-logger.middleware";
import { requestSanitizationMiddleware } from "../middlewares/request-sanitization.middleware";
import { requestTimeoutMiddleware } from "../middlewares/request-timeout.middleware";
import { securityHeadersMiddleware } from "../middlewares/security-headers.middleware";

/**
 * Routes whose body must reach the handler unparsed, because the handler
 * verifies a provider signature over the exact bytes received.
 */
const WEBHOOK_RAW_BODY_PATHS = [
  "/payments/webhooks/square",
  "/sms/webhooks/telnyx",
];

export function createApplication(): Express {
  const app = express();

  // Express defaults that Hono did not have, and that would otherwise change
  // the responses this API has always sent.
  app.disable("x-powered-by");
  app.disable("etag");
  // "simple" matches Hono's flat parsing of nested keys such as ?a[b]=1.
  app.set("query parser", "simple");

  const api = express.Router();
  app.use(getApiRoutePrefix(), api);

  api.use(corsMiddleware);
  api.use(requestIdMiddleware);
  api.use(clientContextMiddleware);
  api.use(containerScopeMiddleware);
  api.use(requestLoggerMiddleware);
  api.use(requestTimeoutMiddleware);
  api.use(requestBodyPolicyMiddleware);
  api.use(requestSanitizationMiddleware);
  api.use("/auth", csrfMiddleware);
  api.use("/auth", idempotencyMiddleware);
  api.use("/payments", idempotencyMiddleware);
  api.use("/booking-requests/:id/payment-session", idempotencyMiddleware);
  api.use(rateLimiterMiddleware);
  api.use(outputFormatMiddleware);
  api.use(securityHeadersMiddleware);
  api.use(httpLoggingMiddleware);

  // Body parsing sits last, immediately before the routes: under Hono the body
  // was only read when a handler called c.req.json(), so parsing after the rate
  // limiter keeps a throttled request from being parsed at all. The limit
  // matches requestBodyPolicyMiddleware, which has already rejected anything
  // that declared an oversized Content-Length.
  const bodyLimit = readRequestBodyMaxBytes();
  api.use("/blob/upload", express.raw({ type: "*/*", limit: bodyLimit }));
  // The webhook handlers only ever read the body as text, to verify a
  // signature over it. Leaving them unparsed keeps those bytes exactly as they
  // arrived and preserves the previous behaviour for a malformed payload, which
  // the handler — not the JSON parser — is the one to judge.
  for (const webhookPath of WEBHOOK_RAW_BODY_PATHS) {
    api.use(webhookPath, express.raw({ type: "*/*", limit: bodyLimit }));
  }
  api.use(
    express.json({
      limit: bodyLimit,
      // Hono's c.req.json() parsed the body whatever the media type, and
      // requestBodyPolicyMiddleware admits any +json suffix, so the parser has
      // to accept the same set or those requests would arrive with an empty
      // body.
      type: ["application/json", "application/*+json"],
      // The webhook handlers verify signatures over the bytes exactly as they
      // arrived, so the unparsed body has to be kept alongside the parsed one.
      verify: (request, _response, buffer) => {
        (request as express.Request).rawBody = buffer;
      },
    }),
  );

  mountRoutes(api);

  // Express would otherwise answer an unmatched route with an HTML page.
  api.use((_request, _response, next) => {
    next(new ResourceNotFoundError("Not found."));
  });

  app.use(handleApplicationError);

  return app;
}
