import type { RootServiceContainer } from "@/configuration/container/core";

export const CONTAINER_REGISTRATION_MODULE_IDS = [
  "shared",
  "sms",
  "security",
  "blob",
  "profile",
  "feedbacks",
  "auth-core",
  "auth-otp",
  "auth-oauth",
  "auth-device",
  "auth-personal-access-tokens",
  "organizations",
  "reports",
  "recommendations-activity",
  "recommendations-precompute",
  "postings-core",
  "postings-analytics",
  "postings-reviews",
  "postings-search",
  "postings-thumbnail",
  "recommendations-query",
  "search",
  "payments",
  "bookings",
  "rentings",
] as const;

export type ContainerRegistrationModuleId =
  (typeof CONTAINER_REGISTRATION_MODULE_IDS)[number];

export interface ContainerRegistrationModule {
  id: ContainerRegistrationModuleId;
  register(container: RootServiceContainer): void;
}


