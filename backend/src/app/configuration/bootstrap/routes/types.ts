import type { Router } from "express";
import type { resolveHandler } from "@/configuration/bootstrap/routes/helpers";

export const ROUTE_MODULE_IDS = [
  "system",
  "auth-local",
  "auth-oauth",
  "auth-devices",
  "auth-personal-access-tokens",
  "auth-mfa-verification",
  "auth-mfa-totp",
  "organizations-profile",
  "organizations-members",
  "organizations-invitations",
  "organizations-audit",
  "organizations-announcements",
  "organizations-blog",
  "organizations-blog-comments",
  "organizations-reviews",
  "blob",
  "profiles",
  "feedbacks",
  "reports",
  "moderation-reports",
  "search-admin",
  "organizations-search-admin",
  "organizations-blog-search-admin",
  "postings-owner",
  "postings-analytics",
  "postings-reviews",
  "postings-availability",
  "postings-seasonal-pricing",
  "postings-activity",
  "postings-saved",
  "postings-saved-searches",
  "bookings",
  "sms",
  "payments",
  "rentings",
  "postings-public",
  "admin-feature-flags",
] as const;

export type RouteModuleId = (typeof ROUTE_MODULE_IDS)[number];

export interface RouteModuleHelpers {
  resolveHandler: typeof resolveHandler;
}

export interface RouteModule {
  id: RouteModuleId;
  featureId?: string;
  /**
   * The parameter must stay named `app` and the registrations must stay literal
   * `app.get("/path", ...)` calls: openapi/validation.ts scrapes these modules
   * with a regex to check the committed spec against the real routes.
   */
  register(app: Router, helpers: RouteModuleHelpers): void;
}
