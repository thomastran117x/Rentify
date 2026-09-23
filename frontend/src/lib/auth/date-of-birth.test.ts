import { describe, expect, it } from "vitest";
import { validateDateOfBirth } from "./date-of-birth";

describe("validateDateOfBirth", () => {
  it("requires a date", () => {
    expect(validateDateOfBirth("")).toBe("Date of birth is required.");
  });

  it("accepts valid dates regardless of whether the user is under 18", () => {
    expect(validateDateOfBirth("2012-06-15")).toBeNull();
  });

  it.each(["2023-02-29", "0000-01-01", "06/15/2012", "not-a-date"])(
    "rejects %s",
    (value) => {
      expect(validateDateOfBirth(value)).toBe("Enter a valid date of birth.");
    },
  );

  it("rejects future dates", () => {
    expect(validateDateOfBirth("2999-01-01")).toBe(
      "Date of birth cannot be in the future.",
    );
  });
});
