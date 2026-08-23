import type { RootServiceContainer } from "@/configuration/container/core";

export const CONTAINER_REGISTRATION_MODULE_IDS = [
  "shared",
  "sms",
  "security",
  "blob",
  "username-bloom",
  "profile",
  "feedbacks",
  "auth-otp",
  "auth-mfa-totp",
  "auth-mfa-verification",
  "auth-core",
  "auth-oauth",
  "auth-device",
  "auth-local",
  "auth-username",
  "auth-lockout",
  "auth-password",
  "auth-personal-access-tokens",
  "organizations-profile",
  "organizations-members",
  "organizations-invitations",
  "organizations-audit",
  "organizations-announcements",
  "organizations-blog",
  "organizations-blog-comments",
  "organizations-reviews",
  "organizations-search",
  "organizations-blog-search",
  "reports",
  "recommendations-activity",
  "recommendations-precompute",
  "postings-core",
  "postings-analytics",
  "postings-reviews",
  "postings-saved",
  "postings-search",
  "postings-thumbnail",
  "recommendations-query",
  "search",
  "payments",
  "bookings",
  "rentings",
  "feature-flags",
] as const;

export type ContainerRegistrationModuleId =
  (typeof CONTAINER_REGISTRATION_MODULE_IDS)[number];

export interface ContainerRegistrationModule {
  id: ContainerRegistrationModuleId;
  register(container: RootServiceContainer): void;
}
