import type { Router } from "express";
import { getApiRoutePrefix } from "@/configuration/http/api-path";
import {
  getEnabledRouteModules,
  logRouteComposition,
  registerRouteModule,
} from "@/configuration/bootstrap/routes/registry";

/**
 * Registers every enabled route module onto the API router.
 *
 * Hono re-derived the /api/v1 base path here; under Express the router is
 * already mounted at that prefix by createApplication, so modules register
 * their paths relative to it.
 */
export function mountRoutes(api: Router): Router {
  for (const routeModule of getEnabledRouteModules()) {
    registerRouteModule(routeModule, api);
  }

  logRouteComposition();

  return api;
}

export { getApiRoutePrefix };
