import { describe, expect, it } from "vitest";
import {
  PASSWORD_REQUIREMENTS,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  UNSAFE_AUTH_INPUT_MESSAGE,
  getPasswordStrengthError,
  passwordByteLength,
  passwordLength,
} from "./password";

function metRequirementIds(password: string) {
  return PASSWORD_REQUIREMENTS.filter((requirement) =>
    requirement.test(password),
  ).map((requirement) => requirement.id);
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

  it("accepts a lowercase passphrase with no character mix", () => {
    expect(getPasswordStrengthError("tidal harbor lantern")).toBeNull();
  });
});
