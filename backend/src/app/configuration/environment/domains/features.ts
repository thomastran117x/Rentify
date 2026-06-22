import { parseBoolean } from "@/configuration/environment/shared";
import type { AppEnvironment } from "@/configuration/environment/types";

// Reads all FEATURE_<NAME>_ENABLED env vars from the original process environment
// and converts them into the features config map.
//
// Feature IDs are derived by lowercasing the name segment and replacing underscores
// with hyphens: FEATURE_SEARCH_V2_ENABLED → "search-v2".
//
// Env var convention: FEATURE_<NAME>_ENABLED=true|false  (default: false — opt-in)
// The feature ID must match the featureId on the corresponding RouteModule.
//
// No changes to RawEnvironmentValues or RAW_ENVIRONMENT_VARIABLE_NAMES are needed
// when adding a new feature flag — just set the env var and tag the RouteModule.

export function buildFeaturesConfig(
  source: NodeJS.ProcessEnv,
): AppEnvironment["features"] {
  const features: AppEnvironment["features"] = {};

  for (const [key, value] of Object.entries(source)) {
    const match = key.match(/^FEATURE_(.+)_ENABLED$/);
    if (match) {
      const featureId = match[1].toLowerCase().replace(/_/g, "-");
      features[featureId] = { enabled: parseBoolean(value, false) };
    }
  }

  return features;
}
