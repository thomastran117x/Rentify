import { Hono } from "hono";
import { loggerFactory } from "@/configuration/logging";
import { environment } from "@/configuration/environment";
import { resolveHandler } from "@/configuration/bootstrap/routes/helpers";
import { getApiRoutePrefix } from "@/configuration/http/api-path";
import { createFeatureFlagMiddleware } from "@/configuration/bootstrap/routes/feature-flag.middleware";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  authDevicesRouteModule,
  authLocalRouteModule,
  authMfaTotpRouteModule,
  authMfaVerificationRouteModule,
  authOauthRouteModule,
  authPersonalAccessTokensRouteModule,
} from "@/configuration/bootstrap/routes/modules/auth.routes";
import { bookingsRouteModule } from "@/configuration/bootstrap/routes/modules/bookings.routes";
import {
  blobRouteModule,
  organizationsBlogSearchAdminRouteModule,
  organizationsSearchAdminRouteModule,
  profilesRouteModule,
  searchAdminRouteModule,
} from "@/configuration/bootstrap/routes/modules/misc.routes";
import { feedbacksRouteModule } from "@/configuration/bootstrap/routes/modules/feedbacks.routes";
import { organizationsRouteModule } from "@/configuration/bootstrap/routes/modules/organizations.routes";
import { paymentsRouteModule } from "@/configuration/bootstrap/routes/modules/payments.routes";
import { smsRouteModule } from "@/configuration/bootstrap/routes/modules/sms.routes";
import {
  postingsActivityRouteModule,
  postingsAnalyticsRouteModule,
  postingsAvailabilityRouteModule,
  postingsOwnerRouteModule,
  postingsPublicRouteModule,
  postingsReviewsRouteModule,
  postingsSavedRouteModule,
  postingsSeasonalPricingRouteModule,
} from "@/configuration/bootstrap/routes/modules/postings.routes";
import {
  moderationReportsRouteModule,
  reportsRouteModule,
} from "@/configuration/bootstrap/routes/modules/reports.routes";
import { rentingsRouteModule } from "@/configuration/bootstrap/routes/modules/rentings.routes";
import { systemRouteModule } from "@/configuration/bootstrap/routes/modules/system.routes";
import { adminFeatureFlagsRouteModule } from "@/configuration/bootstrap/routes/modules/admin-feature-flags.routes";
import type {
  RouteModule,
  RouteModuleHelpers,
  RouteModuleId,
} from "@/configuration/bootstrap/routes/types";

const routesLogger = loggerFactory.forComponent("routes", "app");

export const routeModuleRegistry: RouteModule[] = [
  systemRouteModule,
  authLocalRouteModule,
  authOauthRouteModule,
  authDevicesRouteModule,
  authPersonalAccessTokensRouteModule,
  authMfaVerificationRouteModule,
  authMfaTotpRouteModule,
  organizationsRouteModule,
  blobRouteModule,
  profilesRouteModule,
  feedbacksRouteModule,
  reportsRouteModule,
  moderationReportsRouteModule,
  searchAdminRouteModule,
  organizationsSearchAdminRouteModule,
  organizationsBlogSearchAdminRouteModule,
  postingsOwnerRouteModule,
  postingsAnalyticsRouteModule,
  postingsReviewsRouteModule,
  postingsAvailabilityRouteModule,
  postingsSeasonalPricingRouteModule,
  postingsActivityRouteModule,
  // Must stay ahead of postingsPublicRouteModule: it owns the static
  // /postings/saved paths that /postings/:id would otherwise match.
  postingsSavedRouteModule,
  bookingsRouteModule,
  smsRouteModule,
  paymentsRouteModule,
  rentingsRouteModule,
  postingsPublicRouteModule,
  adminFeatureFlagsRouteModule,
];

const routeModuleHelpers: RouteModuleHelpers = {
  resolveHandler,
};

export function getDisabledRouteModuleIds(): Set<RouteModuleId> {
  return new Set(environment.getRouteModulesConfig().disabledIds);
}

export function filterRouteModules(
  modules: RouteModule[],
  disabledIds: Set<RouteModuleId>,
): RouteModule[] {
  return modules.filter((module) => {
    if (disabledIds.has(module.id)) return false;
    return true;
  });
}

export function getEnabledRouteModules(): RouteModule[] {
  return filterRouteModules(routeModuleRegistry, getDisabledRouteModuleIds());
}

export function logRouteComposition(): void {
  const disabledIds = getDisabledRouteModuleIds();

  const mountedRouteModuleIds: RouteModuleId[] = [];
  const disabledRouteModuleIds: RouteModuleId[] = [];
  const dynamicFeatureGatedRouteModuleIds: RouteModuleId[] = [];

  for (const module of routeModuleRegistry) {
    if (disabledIds.has(module.id)) {
      disabledRouteModuleIds.push(module.id);
    } else {
      if (module.featureId) {
        dynamicFeatureGatedRouteModuleIds.push(module.id);
      }
      mountedRouteModuleIds.push(module.id);
    }
  }

  routesLogger.info("Route modules composed.", {
    apiRoutePrefix: getApiRoutePrefix(),
    disabledRouteModules: disabledRouteModuleIds,
    dynamicFeatureGatedRouteModules: dynamicFeatureGatedRouteModuleIds,
    mountedRouteModules: mountedRouteModuleIds,
  });
}

export function registerRouteModule(
  routeModule: RouteModule,
  app: Hono<AppBindings>,
): void {
  if (routeModule.featureId) {
    const sub = new Hono<AppBindings>();
    sub.use(createFeatureFlagMiddleware(routeModule.featureId));
    routeModule.register(sub, routeModuleHelpers);
    app.route("/", sub);
    return;
  }

  routeModule.register(app, routeModuleHelpers);
}
