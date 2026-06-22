import { describe, expect, it } from "vitest";
import { isFeatureAccessible, type FeatureFlag } from "./features";

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
