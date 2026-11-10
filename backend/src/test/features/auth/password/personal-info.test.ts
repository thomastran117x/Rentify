import {
  containsPersonalInfo,
  personalTokens,
} from "@/features/auth/password/policy/personal-info";

const JORDAN = {
  username: "renter-one",
  email: "jordan.lee+rent@example.com",
  firstName: "Jordan",
  lastName: "Lee",
};

describe("personalTokens", () => {
  it("collects the username, email local part, names and their pieces", () => {
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

  it("skips empty and missing details", () => {
    expect(
      personalTokens({ username: "  ", email: null, firstName: undefined }),
    ).toEqual([]);
  });
});

describe("containsPersonalInfo", () => {
  it.each([
    "MyRenter-One-pass",
    "renter.one.2024!",
    "RENTERONE forever",
    "hello jordan friend",
    "jordanleerent123",
  ])("rejects %s", (password) => {
    expect(containsPersonalInfo(password, JORDAN)).toBe(true);
  });

  it("does not reject on a three-letter name", () => {
    expect(containsPersonalInfo("sleeping-dragon-tea", JORDAN)).toBe(false);
  });

  it("matches names regardless of case", () => {
    expect(
      containsPersonalInfo("Seen-by-MARIA-today", { firstName: "maria" }),
    ).toBe(true);
  });

  it("accepts an unrelated passphrase", () => {
    expect(containsPersonalInfo("tidal-harbor-lantern", JORDAN)).toBe(false);
  });

  it("accepts anything when there is no context", () => {
    expect(containsPersonalInfo("renter-one", {})).toBe(false);
  });
});
