import {
  createCommonPasswordMatcher,
  isCommonPassword,
  parseCommonPasswordList,
} from "@/features/auth/password/policy/common-passwords";

describe("parseCommonPasswordList", () => {
  it("lowercases entries and skips comments and blank lines", () => {
    expect(
      parseCommonPasswordList("# header\r\nPassword\n\n  monkey  \npassword\n"),
    ).toEqual(new Set(["password", "monkey"]));
  });
});

describe("createCommonPasswordMatcher", () => {
  const isCommon = createCommonPasswordMatcher(
    new Set(["password", "qwertyuiop", "trustno1", "abc", "superlongpassword"]),
  );

  it("matches a listed entry in any case", () => {
    expect(isCommon("SuperLongPassword")).toBe(true);
  });

  it("matches a listed entry padded with digits or symbols", () => {
    expect(isCommon("Password1234!")).toBe(true);
    expect(isCommon("!!qwertyuiop12")).toBe(true);
  });

  it("ignores a listed core shorter than four letters", () => {
    expect(isCommon("!!abc!!123456")).toBe(false);
    expect(isCommon("1234abc56789")).toBe(false);
  });

  it("does not match a listed word inside a longer phrase", () => {
    expect(isCommon("my-password-is-long")).toBe(false);
  });

  it.each([
    "aaaaaaaaaaaa",
    "abcdefghijkl",
    "ABCDEFGHIJKL",
    "lkjihgfedcba",
    "123456789012",
    "987654321098",
  ])("matches the trivial run %s", (value) => {
    expect(isCommon(value)).toBe(true);
  });

  it("does not treat a run with uneven steps as trivial", () => {
    expect(isCommon("acegikmoqsuw")).toBe(false);
    expect(isCommon("ajajajajajajx")).toBe(false);
  });

  it("matches a short unit or a listed word repeated", () => {
    expect(isCommon("abcdabcdabcd")).toBe(true);
    expect(isCommon("trustno1trustno1")).toBe(true);
    expect(isCommon("1212121212121212")).toBe(true);
  });

  it("does not reject a long unit repeated once", () => {
    expect(isCommon("tidalharbortidalharbor")).toBe(false);
  });

  it("accepts an ordinary passphrase", () => {
    expect(isCommon("tidal-harbor-lantern")).toBe(false);
    expect(isCommon("x")).toBe(false);
  });
});

describe("isCommonPassword", () => {
  it("loads the bundled list", () => {
    expect(isCommonPassword("password1234")).toBe(true);
    expect(isCommonPassword("Football2024!")).toBe(true);
    expect(isCommonPassword("iloveyou1234")).toBe(true);
    expect(isCommonPassword("tidal-harbor-lantern")).toBe(false);
  });

  it.each([
    "StrongPassword1!",
    "ResetPassword1!",
    "ChangedPassword1!",
    "SetFirstPassword1!",
    "CorrectHorseBatteryStaple1!",
    "AnotherStrongPassword1!",
  ])("does not reject the test fixture %s", (value) => {
    expect(isCommonPassword(value)).toBe(false);
  });
});
