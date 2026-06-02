import type { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import type { resolveHandler } from "@/configuration/bootstrap/routes/helpers";

export const ROUTE_MODULE_IDS = [
  "system",
  "auth-local",
  "auth-oauth",
  "auth-devices",
  "auth-personal-access-tokens",
  "organizations",
  "blob",
  "profiles",
  "reports",
  "moderation-reports",
  "search-admin",
  "postings-owner",
  "postings-analytics",
  "postings-reviews",
  "postings-availability",
  "postings-activity",
  "bookings",
  "payments",
  "rentings",
  "postings-public",
] as const;

export type RouteModuleId = (typeof ROUTE_MODULE_IDS)[number];

export interface RouteModuleHelpers {
  resolveHandler: typeof resolveHandler;
}

export interface RouteModule {
  id: RouteModuleId;
  register(app: Hono<AppBindings>, helpers: RouteModuleHelpers): void;
}
