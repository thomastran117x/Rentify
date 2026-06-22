import { isModeratorRole, type AppUserRole } from "@/lib/auth/roles";

type FeatureAccess = "all" | "internal";

export interface FeatureFlag {
  enabled: boolean;
  access: FeatureAccess;
}

const TRUTHY = new Set(["true", "1", "yes", "on"]);

export function flag(enabledEnv?: string, accessEnv?: string): FeatureFlag {
  return {
    enabled: TRUTHY.has(enabledEnv?.trim().toLowerCase() ?? ""),
    access: accessEnv?.trim().toLowerCase() === "internal" ? "internal" : "all",
  };
}

// Add entries here as new features are developed.
//
// Env var convention:
//   NEXT_PUBLIC_FEATURE_<NAME>_ENABLED=true|false   (required to opt in)
//   NEXT_PUBLIC_FEATURE_<NAME>_ACCESS=internal       (optional; omit or set "all" for all users)
//
// Example:
//   searchV2: flag(
//     process.env.NEXT_PUBLIC_FEATURE_SEARCH_V2_ENABLED,
//     process.env.NEXT_PUBLIC_FEATURE_SEARCH_V2_ACCESS,
//   ),
export const features = {
  //
} satisfies Record<string, FeatureFlag>;

export type FeatureName = keyof typeof features;

export function isFeatureAccessible(
  feature: FeatureFlag,
  role?: AppUserRole,
): boolean {
  if (!feature.enabled) return false;
  if (feature.access === "internal") return isModeratorRole(role);
  return true;
}
