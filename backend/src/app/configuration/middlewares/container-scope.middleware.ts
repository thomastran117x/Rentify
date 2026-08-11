import type { RequestHandler } from "express";
import { getContainer } from "@/configuration/bootstrap/container";
import { runAfterResponse } from "@/configuration/http/response-lifecycle";

export const containerScopeMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  const scope = getContainer().createScope();
  request.container = scope;

  // Hono disposed the scope in a `finally` around `await next()`. Express has
  // no such seam, so the disposal hangs off the response lifecycle instead —
  // which also covers aborted requests, where the handler never completes.
  runAfterResponse(response, () => scope.dispose());

  next();
};
