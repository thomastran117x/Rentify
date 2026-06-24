import { describe, expect, it } from "vitest";
import {
  flag,
  isFeatureAccessible,
  normalizeFeatureName,
  type FeatureFlag,
} from "./features";

describe("normalizeFeatureName", () => {
  it("strips FEATURE_ prefix and _ENABLED suffix", () => {
    expect(normalizeFeatureName("FEATURE_TEST_FLAG_ENABLED")).toBe("test-flag");
  });

  it("lowercases and replaces underscores with hyphens", () => {
    expect(normalizeFeatureName("test_flag")).toBe("test-flag");
  });

  it("passes through canonical kebab-case unchanged", () => {
    expect(normalizeFeatureName("test-flag")).toBe("test-flag");
  });

  it("is case-insensitive for the FEATURE_ prefix and _ENABLED suffix", () => {
    expect(normalizeFeatureName("feature_search_v2_enabled")).toBe("search-v2");
  });
});

describe("flag", () => {
  it("is disabled when the env var is absent or empty", () => {
    expect(flag(undefined).enabled).toBe(false);
    expect(flag("").enabled).toBe(false);
    expect(flag("  ").enabled).toBe(false);
  });

  it("accepts the same truthy synonyms as the backend parseBoolean", () => {
    expect(flag("true").enabled).toBe(true);
    expect(flag("1").enabled).toBe(true);
    expect(flag("yes").enabled).toBe(true);
    expect(flag("on").enabled).toBe(true);
  });

  it("is case-insensitive for the enabled env var", () => {
    expect(flag("TRUE").enabled).toBe(true);
    expect(flag("True").enabled).toBe(true);
    expect(flag("YES").enabled).toBe(true);
  });

  it("defaults access to 'all' when the access env var is absent", () => {
    expect(flag("true").access).toBe("all");
    expect(flag("true", undefined).access).toBe("all");
    expect(flag("true", "anything-else").access).toBe("all");
  });

  it("sets access to 'internal' when the env var is 'internal' (case-insensitive)", () => {
    expect(flag("true", "internal").access).toBe("internal");
    expect(flag("true", "INTERNAL").access).toBe("internal");
  });
});

describe("isFeatureAccessible", () => {
  describe("disabled feature", () => {
    it("returns false regardless of access level", () => {
      const flag: FeatureFlag = { enabled: false, access: "all" };
      expect(isFeatureAccessible(flag)).toBe(false);
    });

    it("returns false regardless of role", () => {
      const flag: FeatureFlag = { enabled: false, access: "all" };
      expect(isFeatureAccessible(flag, "user")).toBe(false);
      expect(isFeatureAccessible(flag, "owner")).toBe(false);
      expect(isFeatureAccessible(flag, "moderator")).toBe(false);
      expect(isFeatureAccessible(flag, "admin")).toBe(false);
    });

    it("returns false even for internal access with an admin role", () => {
      const flag: FeatureFlag = { enabled: false, access: "internal" };
      expect(isFeatureAccessible(flag, "admin")).toBe(false);
    });
  });

  describe("enabled feature with access 'all'", () => {
    const flag: FeatureFlag = { enabled: true, access: "all" };

    it("returns true when no role is provided", () => {
      expect(isFeatureAccessible(flag)).toBe(true);
      expect(isFeatureAccessible(flag, undefined)).toBe(true);
    });

    it("returns true for every role", () => {
      expect(isFeatureAccessible(flag, "user")).toBe(true);
      expect(isFeatureAccessible(flag, "owner")).toBe(true);
      expect(isFeatureAccessible(flag, "moderator")).toBe(true);
      expect(isFeatureAccessible(flag, "admin")).toBe(true);
    });
  });

  describe("enabled feature with access 'internal'", () => {
    const flag: FeatureFlag = { enabled: true, access: "internal" };

    it("returns false when no role is provided", () => {
      expect(isFeatureAccessible(flag)).toBe(false);
      expect(isFeatureAccessible(flag, undefined)).toBe(false);
    });

    it("returns false for non-internal roles", () => {
      expect(isFeatureAccessible(flag, "user")).toBe(false);
      expect(isFeatureAccessible(flag, "owner")).toBe(false);
    });

    it("returns true for moderator and admin", () => {
      expect(isFeatureAccessible(flag, "moderator")).toBe(true);
      expect(isFeatureAccessible(flag, "admin")).toBe(true);
    });
  });
});
