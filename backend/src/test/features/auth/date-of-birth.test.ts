import {
  dateOfBirthSchema,
  fromDateOfBirthPersistence,
  isValidDateOfBirth,
  toDateOfBirthPersistence,
} from "@/features/auth/date-of-birth";

describe("dateOfBirthSchema", () => {
  it.each(["2024-02-29", "2012-06-15", "0001-01-01"])(
    "accepts the real non-future date %s",
    (value) => {
      expect(dateOfBirthSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    "2023-02-29",
    "2026-13-01",
    "0000-01-01",
    "06/15/2012",
    "not-a-date",
  ])("rejects the invalid date %s", (value) => {
    expect(() => dateOfBirthSchema.parse(value)).toThrow();
  });

  it("rejects a date after the supplied UTC day", () => {
    expect(isValidDateOfBirth("2026-09-23", "2026-09-22")).toBe(false);
    expect(isValidDateOfBirth("2026-09-22", "2026-09-22")).toBe(true);
  });

  it("round-trips a date without a timezone shift", () => {
    expect(
      fromDateOfBirthPersistence(toDateOfBirthPersistence("2012-06-15")),
    ).toBe("2012-06-15");
  });
});
