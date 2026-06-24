import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { loggerFactory } from "@/configuration/logging";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  containerTokens,
  getRequestContainer,
} from "@/configuration/bootstrap/container";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";

const logger = loggerFactory.forComponent("feature-flag-middleware", "app");

export function createFeatureFlagMiddleware(
  featureId: string,
): MiddlewareHandler<AppBindings> {
  return createMiddleware<AppBindings>(async (context, next) => {
    const service = getRequestContainer(context).resolve(
      containerTokens.featureFlagService,
    );

    const enabled = await service.isEnabled(featureId);

    if (!enabled) {
      logger.info(
        { featureId, path: context.req.path },
        "Feature-gated route blocked.",
      );
      throw new ResourceNotFoundError("Not found.");
    }

    await next();
  });
}
