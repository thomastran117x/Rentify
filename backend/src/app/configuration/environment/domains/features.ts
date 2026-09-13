import { parseBoolean } from "@/configuration/environment/shared";
import type { AppEnvironment } from "@/configuration/environment/types";

// Starts with the YAML feature map, then applies FEATURE_<NAME>_ENABLED values
// from the original process environment as explicit deployment overrides.
//
// Feature IDs are derived by lowercasing the name segment and replacing underscores
// with hyphens: FEATURE_SEARCH_V2_ENABLED → "search-v2".
//
// Env var convention: FEATURE_<NAME>_ENABLED=true|false.
// Flags absent from both sources remain disabled by the feature-flag service.
// The feature ID must match the featureId on the corresponding RouteModule.
//
// No changes to RawEnvironmentValues or RAW_ENVIRONMENT_VARIABLE_NAMES are needed
// when adding a new feature flag — just set the env var and tag the RouteModule.

// Converts any flag name form to canonical kebab-case:
// "FEATURE_TEST_FLAG_ENABLED" → "test-flag"
// "test_flag"                 → "test-flag"
// "test-flag"                 → "test-flag"
export function normalizeFeatureName(raw: string): string {
  return raw
    .replace(/^FEATURE_/i, "")
    .replace(/_ENABLED$/i, "")
    .toLowerCase()
    .replace(/_/g, "-");
}

export function buildFeaturesConfig(
  source: NodeJS.ProcessEnv,
  configuredFeatures: AppEnvironment["features"] = {},
): AppEnvironment["features"] {
  const features: AppEnvironment["features"] = { ...configuredFeatures };

  for (const [key, value] of Object.entries(source)) {
    const match = key.match(/^FEATURE_(.+)_ENABLED$/);
    if (match) {
      const featureId = normalizeFeatureName(key);
      features[featureId] = {
        enabled: parseBoolean(value, false),
        source: "env",
      };
    }
  }

  return features;
}
