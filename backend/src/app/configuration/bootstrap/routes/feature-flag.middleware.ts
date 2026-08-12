import type { RequestHandler } from "express";
import { loggerFactory } from "@/configuration/logging";
import {
  containerTokens,
  getRequestContainer,
} from "@/configuration/bootstrap/container";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";

const logger = loggerFactory.forComponent("feature-flag-middleware", "app");

export function createFeatureFlagMiddleware(featureId: string): RequestHandler {
  return async (request, _response, next) => {
    try {
      const service = getRequestContainer(request).resolve(
        containerTokens.featureFlagService,
      );

      const enabled = await service.isEnabled(featureId);

      if (!enabled) {
        logger.info("Feature-gated route blocked.", {
          featureId,
          path: request.path,
        });
        throw new ResourceNotFoundError("Not found.");
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
