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
import { paymentsRouteModule } from "@/configuration/bootstrap/routes/modules/payments.routes";
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
  blobRouteModule,
  profilesRouteModule,
  reportsRouteModule,
  moderationReportsRouteModule,
  searchAdminRouteModule,
  postingsOwnerRouteModule,
  postingsAnalyticsRouteModule,
  postingsReviewsRouteModule,
  postingsAvailabilityRouteModule,
  postingsActivityRouteModule,
  bookingsRouteModule,
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

export function getEnabledRouteModules(): RouteModule[] {
  const disabledRouteModuleIds = getDisabledRouteModuleIds();

  return routeModuleRegistry.filter(
    (routeModule) => !disabledRouteModuleIds.has(routeModule.id),
  );
}

export function logRouteComposition(): void {
  const disabledRouteModuleIds = Array.from(getDisabledRouteModuleIds());
  const mountedRouteModuleIds = routeModuleRegistry
    .map((routeModule) => routeModule.id)
    .filter((routeModuleId) => !disabledRouteModuleIds.includes(routeModuleId));

  routesLogger.info("Route modules composed.", {
    apiRoutePrefix: getApiRoutePrefix(),
    disabledRouteModules: disabledRouteModuleIds,
    mountedRouteModules: mountedRouteModuleIds,
  });
}

export function registerRouteModule(
  routeModule: RouteModule,
  app: Parameters<RouteModule["register"]>[0],
): void {
  routeModule.register(app, routeModuleHelpers);
}
