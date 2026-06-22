import { loggerFactory } from "@/configuration/logging";
import { environment } from "@/configuration/environment";
import { resolveHandler } from "@/configuration/bootstrap/routes/helpers";
import { getApiRoutePrefix } from "@/configuration/http/api-path";
import {
  authDevicesRouteModule,
  authLocalRouteModule,
  authOauthRouteModule,
  authPersonalAccessTokensRouteModule,
} from "@/configuration/bootstrap/routes/modules/auth.routes";
import { bookingsRouteModule } from "@/configuration/bootstrap/routes/modules/bookings.routes";
import {
  blobRouteModule,
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
} from "@/configuration/bootstrap/routes/modules/postings.routes";
import {
  moderationReportsRouteModule,
  reportsRouteModule,
} from "@/configuration/bootstrap/routes/modules/reports.routes";
import { rentingsRouteModule } from "@/configuration/bootstrap/routes/modules/rentings.routes";
import { systemRouteModule } from "@/configuration/bootstrap/routes/modules/system.routes";
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
  organizationsRouteModule,
  blobRouteModule,
  profilesRouteModule,
  feedbacksRouteModule,
  reportsRouteModule,
  moderationReportsRouteModule,
  searchAdminRouteModule,
  postingsOwnerRouteModule,
  postingsAnalyticsRouteModule,
  postingsReviewsRouteModule,
  postingsAvailabilityRouteModule,
  postingsActivityRouteModule,
  bookingsRouteModule,
  smsRouteModule,
  paymentsRouteModule,
  rentingsRouteModule,
  postingsPublicRouteModule,
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
  features: Record<string, { enabled: boolean }>,
): RouteModule[] {
  return modules.filter((module) => {
    if (disabledIds.has(module.id)) return false;
    if (module.featureId && features[module.featureId]?.enabled !== true)
      return false;
    return true;
  });
}

export function getEnabledRouteModules(): RouteModule[] {
  return filterRouteModules(
    routeModuleRegistry,
    getDisabledRouteModuleIds(),
    environment.getFeaturesConfig(),
  );
}

export function logRouteComposition(): void {
  const disabledIds = getDisabledRouteModuleIds();
  const features = environment.getFeaturesConfig();

  const mountedRouteModuleIds: RouteModuleId[] = [];
  const disabledRouteModuleIds: RouteModuleId[] = [];
  const featureGatedRouteModuleIds: RouteModuleId[] = [];

  for (const module of routeModuleRegistry) {
    if (disabledIds.has(module.id)) {
      disabledRouteModuleIds.push(module.id);
    } else if (
      module.featureId &&
      features[module.featureId]?.enabled !== true
    ) {
      featureGatedRouteModuleIds.push(module.id);
    } else {
      mountedRouteModuleIds.push(module.id);
    }
  }

  routesLogger.info("Route modules composed.", {
    apiRoutePrefix: getApiRoutePrefix(),
    disabledRouteModules: disabledRouteModuleIds,
    featureGatedRouteModules: featureGatedRouteModuleIds,
    mountedRouteModules: mountedRouteModuleIds,
  });
}

export function registerRouteModule(
  routeModule: RouteModule,
  app: Parameters<RouteModule["register"]>[0],
): void {
  routeModule.register(app, routeModuleHelpers);
}
