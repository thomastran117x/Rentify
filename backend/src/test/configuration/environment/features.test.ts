import { buildFeaturesConfig } from "@/configuration/environment/domains/features";

describe("buildFeaturesConfig", () => {
  it("returns an empty record when no FEATURE_*_ENABLED vars are present", () => {
    expect(buildFeaturesConfig({})).toEqual({});
  });

  it("parses a truthy FEATURE_*_ENABLED var as enabled", () => {
    expect(buildFeaturesConfig({ FEATURE_SEARCH_V2_ENABLED: "true" })).toEqual({
      "search-v2": { enabled: true },
    });
  });

  it("parses a falsy FEATURE_*_ENABLED var as disabled", () => {
    expect(buildFeaturesConfig({ FEATURE_SEARCH_V2_ENABLED: "false" })).toEqual(
      { "search-v2": { enabled: false } },
    );
  });

  it("defaults to disabled when the var is absent", () => {
    const result = buildFeaturesConfig({});
    expect(result["search-v2"]).toBeUndefined();
  });

  it("accepts all truthy synonyms accepted by parseBoolean", () => {
    expect(buildFeaturesConfig({ FEATURE_X_ENABLED: "1" })["x"]?.enabled).toBe(
      true,
    );
    expect(
      buildFeaturesConfig({ FEATURE_X_ENABLED: "yes" })["x"]?.enabled,
    ).toBe(true);
    expect(buildFeaturesConfig({ FEATURE_X_ENABLED: "on" })["x"]?.enabled).toBe(
      true,
    );
  });

  it("converts SCREAMING_SNAKE_CASE name to kebab-case feature ID", () => {
    const result = buildFeaturesConfig({
      FEATURE_MY_NEW_FEATURE_ENABLED: "true",
    });
    expect(result["my-new-feature"]).toEqual({ enabled: true });
  });

  it("parses multiple features independently", () => {
    const result = buildFeaturesConfig({
      FEATURE_ALPHA_ENABLED: "true",
      FEATURE_BETA_ENABLED: "false",
      FEATURE_GAMMA_ENABLED: "true",
    });
    expect(result).toEqual({
      alpha: { enabled: true },
      beta: { enabled: false },
      gamma: { enabled: true },
    });
  });

  it("ignores env vars that do not match the FEATURE_*_ENABLED pattern", () => {
    const result = buildFeaturesConfig({
      NODE_ENV: "test",
      FEATURE_SEARCH_V2_ENABLED: "true",
      FEATURE_SEARCH_V2_ACCESS: "internal",
      MY_FEATURE_ENABLED: "true",
    });
    expect(Object.keys(result)).toEqual(["search-v2"]);
  });
});
