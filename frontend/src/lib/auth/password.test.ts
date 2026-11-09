import { describe, expect, it } from "vitest";
import {
  PASSWORD_REQUIREMENTS,
  PERSONAL_INFO_PASSWORD_MESSAGE,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  UNSAFE_AUTH_INPUT_MESSAGE,
  containsPersonalInfo,
  getApplicablePasswordRequirements,
  getPasswordStrengthError,
  passwordByteLength,
  passwordLength,
  personalTokens,
} from "./password";

const JORDAN = {
  username: "renter-one",
  email: "jordan.lee+rent@example.com",
  firstName: "Jordan",
  lastName: "Lee",
};

function metRequirementIds(password: string, context = {}) {
  return getApplicablePasswordRequirements(context)
    .filter((requirement) => requirement.test(password, context))
    .map((requirement) => requirement.id);
}

describe("password length helpers", () => {
  it("counts code points and UTF-8 bytes like the backend", () => {
    expect(passwordLength("😀😀")).toBe(2);
    expect(passwordByteLength("😀")).toBe(4);
    expect(passwordByteLength("é")).toBe(2);
  });
});

describe("PASSWORD_REQUIREMENTS", () => {
  it("meets nothing for an empty password", () => {
    expect(metRequirementIds("")).toEqual([]);
  });

  it("needs 12 characters and nothing else", () => {
    expect(metRequirementIds("abcdefghijk")).toEqual([]);
    expect(metRequirementIds("abcdefghijkl")).toEqual(["length"]);
  });

  it("adds the personal row only when the form knows something", () => {
    expect(getApplicablePasswordRequirements().map((r) => r.id)).toEqual([
      "length",
    ]);
    expect(
      getApplicablePasswordRequirements({ firstName: "Lee" }).map((r) => r.id),
    ).toEqual(["length"]);
    expect(getApplicablePasswordRequirements(JORDAN).map((r) => r.id)).toEqual([
      "length",
      "personal",
    ]);
    expect(PASSWORD_REQUIREMENTS).toHaveLength(2);
  });

  it("meets the personal row only once something unrelated is typed", () => {
    expect(metRequirementIds("", JORDAN)).toEqual([]);
    expect(metRequirementIds("tidal", JORDAN)).toEqual(["personal"]);
    expect(metRequirementIds("tidal-harbor-jordan", JORDAN)).toEqual([
      "length",
    ]);
  });
});

describe("containsPersonalInfo", () => {
  it("mirrors the backend tokens", () => {
    expect(personalTokens(JORDAN)).toEqual([
      "renter-one",
      "renterone",
      "renter",
      "jordan.lee+rent",
      "jordanleerent",
      "jordan",
      "rent",
    ]);
  });

  it("ignores case and separators but skips three-letter names", () => {
    expect(containsPersonalInfo("Renter.One-2024!", JORDAN)).toBe(true);
    expect(containsPersonalInfo("sleeping-dragon-tea", JORDAN)).toBe(false);
  });
});

describe("getPasswordStrengthError", () => {
  it("rejects fewer than 12 characters", () => {
    expect(getPasswordStrengthError("Rentify123!")).toBe(
      PASSWORD_TOO_SHORT_MESSAGE,
    );
    expect(getPasswordStrengthError("😀".repeat(11))).toBe(
      PASSWORD_TOO_SHORT_MESSAGE,
    );
  });

  it("rejects more than 72 bytes, counting multi-byte characters", () => {
    expect(getPasswordStrengthError("a".repeat(72))).toBeNull();
    expect(getPasswordStrengthError("a".repeat(73))).toBe(
      PASSWORD_TOO_LONG_MESSAGE,
    );
    expect(getPasswordStrengthError("😀".repeat(18))).toBeNull();
    expect(getPasswordStrengthError("😀".repeat(19))).toBe(
      PASSWORD_TOO_LONG_MESSAGE,
    );
  });

  it("rejects unsafe markup once the length is met", () => {
    expect(getPasswordStrengthError("<b>")).toBe(PASSWORD_TOO_SHORT_MESSAGE);
    expect(getPasswordStrengthError("<b>long enough</b>")).toBe(
      UNSAFE_AUTH_INPUT_MESSAGE,
    );
  });

  it("rejects a password containing the user's details", () => {
    expect(getPasswordStrengthError("my-renter-one-pass", JORDAN)).toBe(
      PERSONAL_INFO_PASSWORD_MESSAGE,
    );
    expect(getPasswordStrengthError("my-renter-one-pass")).toBeNull();
  });

  it("accepts a lowercase passphrase with no character mix", () => {
    expect(getPasswordStrengthError("tidal harbor lantern")).toBeNull();
  });
});
