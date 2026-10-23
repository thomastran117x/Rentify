import { describe, expect, it } from "vitest";
import {
  PASSWORD_REQUIREMENTS,
  STRONG_PASSWORD_MESSAGE,
  UNSAFE_AUTH_INPUT_MESSAGE,
  getPasswordStrengthError,
  isStrongPassword,
} from "./password";

function metRequirementIds(password: string) {
  return PASSWORD_REQUIREMENTS.filter((requirement) =>
    requirement.test(password),
  ).map((requirement) => requirement.id);
}

describe("PASSWORD_REQUIREMENTS", () => {
  it("meets nothing for an empty password", () => {
    expect(metRequirementIds("")).toEqual([]);
  });

  it("reports each character class on its own", () => {
    expect(metRequirementIds("A")).toEqual(["uppercase"]);
    expect(metRequirementIds("a")).toEqual(["lowercase"]);
    expect(metRequirementIds("1")).toEqual(["number"]);
    expect(metRequirementIds("!")).toEqual(["special"]);
    expect(metRequirementIds("        ")).toEqual(["length", "special"]);
  });

  it("meets every requirement for a strong password", () => {
    expect(metRequirementIds("Abcdefg1!")).toEqual([
      "length",
      "uppercase",
      "lowercase",
      "number",
      "special",
    ]);
  });
});

describe("isStrongPassword", () => {
  it("accepts only a password meeting every requirement", () => {
    expect(isStrongPassword("Abcdefg1!")).toBe(true);
    expect(isStrongPassword("Abcde1!")).toBe(false);
    expect(isStrongPassword("abcdefg1!")).toBe(false);
    expect(isStrongPassword("ABCDEFG1!")).toBe(false);
    expect(isStrongPassword("Abcdefgh!")).toBe(false);
    expect(isStrongPassword("Abcdefgh1")).toBe(false);
  });
});

describe("getPasswordStrengthError", () => {
  it("checks length, then unsafe input, then character classes", () => {
    expect(getPasswordStrengthError("<b>")).toBe(STRONG_PASSWORD_MESSAGE);
    expect(getPasswordStrengthError("<b>Abc1!</b>")).toBe(
      UNSAFE_AUTH_INPUT_MESSAGE,
    );
    expect(getPasswordStrengthError("password123")).toBe(
      STRONG_PASSWORD_MESSAGE,
    );
    expect(getPasswordStrengthError("Abcdefg1!")).toBeNull();
  });
});
