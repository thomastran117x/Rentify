import { describe, expect, it } from "vitest";
import {
  hasValidUsernameFormat,
  normalizeUsername,
  USERNAME_REQUIRED_MESSAGE,
  USERNAME_RULE_MESSAGE,
  validateUsernameFormat,
} from "./username";

describe("normalizeUsername", () => {
  it("trims and lowercases, matching the backend", () => {
    expect(normalizeUsername("  Jane-Doe  ")).toBe("jane-doe");
  });
});

describe("hasValidUsernameFormat", () => {
  it.each([
    "abc",
    "jane-doe",
    "jane.doe",
    "jane_doe",
    "a1.b-c_d",
    "a".repeat(50),
  ])("accepts %s", (value) => {
    expect(hasValidUsernameFormat(value)).toBe(true);
  });

  it.each(["ab", "a".repeat(51), "jane doe", "jane@doe", "jané", ""])(
    "rejects %s",
    (value) => {
      expect(hasValidUsernameFormat(value)).toBe(false);
    },
  );
});

describe("validateUsernameFormat", () => {
  it("reports a missing username", () => {
    expect(validateUsernameFormat("   ")).toBe(USERNAME_REQUIRED_MESSAGE);
  });

  it("reports a malformed username", () => {
    expect(validateUsernameFormat("ab")).toBe(USERNAME_RULE_MESSAGE);
    expect(validateUsernameFormat("jane doe")).toBe(USERNAME_RULE_MESSAGE);
  });

  it("returns undefined for a valid username", () => {
    expect(validateUsernameFormat("  Jane-Doe  ")).toBeUndefined();
  });
});
