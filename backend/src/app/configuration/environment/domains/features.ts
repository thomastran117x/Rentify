import { parseBoolean } from "@/configuration/environment/shared";
import type {
  AppEnvironment,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

// Add feature entries here as features are developed, following this pattern:
//
//   "feature-name": { enabled: parseBoolean(raw.FEATURE_<NAME>_ENABLED, false) },
//
// Also add the corresponding FEATURE_<NAME>_ENABLED?: string key to RawEnvironmentValues.
// Use false as the default — features are opt-in (disabled unless explicitly enabled).
//
// Env var convention: FEATURE_<NAME>_ENABLED=true|false
// Backend feature IDs use kebab-case and must match the featureId on the RouteModule.
//
// Example:
//   "search-v2": { enabled: parseBoolean(raw.FEATURE_SEARCH_V2_ENABLED, false) },

export function buildFeaturesConfig(
  raw: RawEnvironmentValues,
): AppEnvironment["features"] {
  void raw; // remove when first feature is added
  return {};
}
