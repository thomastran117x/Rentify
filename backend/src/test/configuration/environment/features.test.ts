import { buildFeaturesConfig } from "@/configuration/environment/domains/features";
import type { RawEnvironmentValues } from "@/configuration/environment/types";

describe("buildFeaturesConfig", () => {
  it("returns an empty record when no features are declared", () => {
    const raw: RawEnvironmentValues = {};
    expect(buildFeaturesConfig(raw)).toEqual({});
  });

  // When a feature is added to buildFeaturesConfig, add tests here.
  // Pattern to follow for each new feature:
  //
  //   it("enables <feature> when FEATURE_<NAME>_ENABLED is true", () => {
  //     const raw: RawEnvironmentValues = { FEATURE_MY_FEATURE_ENABLED: "true" };
  //     expect(buildFeaturesConfig(raw)).toEqual({
  //       "my-feature": { enabled: true },
  //     });
  //   });
  //
  //   it("disables <feature> when FEATURE_<NAME>_ENABLED is false", () => {
  //     const raw: RawEnvironmentValues = { FEATURE_MY_FEATURE_ENABLED: "false" };
  //     expect(buildFeaturesConfig(raw)).toEqual({
  //       "my-feature": { enabled: false },
  //     });
  //   });
  //
  //   it("disables <feature> when FEATURE_<NAME>_ENABLED is absent", () => {
  //     const raw: RawEnvironmentValues = {};
  //     expect(buildFeaturesConfig(raw)["my-feature"]).toEqual({ enabled: false });
  //   });
});
