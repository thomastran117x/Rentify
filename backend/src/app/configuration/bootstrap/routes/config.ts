import {
  ROUTE_MODULE_IDS,
  type RouteModuleId,
} from "@/configuration/bootstrap/routes/types";

export function parseDisabledRouteModuleIds(value?: string): {
  disabledIds: RouteModuleId[];
  invalidIds: string[];
} {
  const configuredIds = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const uniqueIds = Array.from(new Set(configuredIds));

  return {
    disabledIds: uniqueIds.filter(
      (configuredId): configuredId is RouteModuleId =>
        ROUTE_MODULE_IDS.includes(configuredId as RouteModuleId),
    ),
    invalidIds: uniqueIds.filter(
      (configuredId) =>
        !ROUTE_MODULE_IDS.includes(configuredId as RouteModuleId),
    ),
  };
}
