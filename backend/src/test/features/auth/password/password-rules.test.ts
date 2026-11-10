import { strongPasswordSchema } from "@/features/auth/auth.model";
import { UNSAFE_AUTH_INPUT_MESSAGE } from "@/features/auth/unsafe-input";
import {
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  checkPasswordShape,
  passwordByteLength,
  passwordLength,
} from "@/features/auth/password/policy/password-rules";

function schemaMessages(value: string): string[] {
  const result = strongPasswordSchema.safeParse(value);

  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
}

describe("password length helpers", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(passwordLength("😀😀")).toBe(2);
    expect("😀😀".length).toBe(4);
  });

  it("counts UTF-8 bytes", () => {
    expect(passwordByteLength("abc")).toBe(3);
    expect(passwordByteLength("é")).toBe(2);
    expect(passwordByteLength("😀")).toBe(4);
  });
});

describe("checkPasswordShape", () => {
  it("accepts 12 characters with no composition mix", () => {
    expect(checkPasswordShape("abcdefghijkl")).toEqual([]);
  });

  it("rejects 11 characters", () => {
    expect(checkPasswordShape("Rentify123!")).toEqual([
      { code: "too_short", message: PASSWORD_TOO_SHORT_MESSAGE },
    ]);
  });

  it("accepts exactly 72 bytes and rejects 73", () => {
    expect(checkPasswordShape("a".repeat(72))).toEqual([]);
    expect(checkPasswordShape("a".repeat(73))).toEqual([
      { code: "too_long", message: PASSWORD_TOO_LONG_MESSAGE },
    ]);
  });

  it("measures the cap in bytes for multi-byte characters", () => {
    // 18 emoji are 72 bytes; a 19th takes it over even though it is only 19
    // characters, which is where bcrypt would start ignoring input.
    expect(checkPasswordShape("😀".repeat(18))).toEqual([]);
    expect(checkPasswordShape("😀".repeat(19))).toEqual([
      { code: "too_long", message: PASSWORD_TOO_LONG_MESSAGE },
    ]);
    // 24 CJK characters are 72 bytes.
    expect(checkPasswordShape("密".repeat(24))).toEqual([]);
    expect(checkPasswordShape("密".repeat(25))).toHaveLength(1);
  });

  it("rejects markup, which every auth field refuses", () => {
    expect(checkPasswordShape("<b>tidal-harbor-lantern</b>")).toEqual([
      { code: "unsafe_input", message: UNSAFE_AUTH_INPUT_MESSAGE },
    ]);
    expect(checkPasswordShape("<b>x</b>")).toEqual([
      { code: "too_short", message: PASSWORD_TOO_SHORT_MESSAGE },
      { code: "unsafe_input", message: UNSAFE_AUTH_INPUT_MESSAGE },
    ]);
  });

  it("counts a short emoji password by characters, not bytes", () => {
    // 11 emoji are 44 bytes but only 11 characters, so still too short.
    expect(checkPasswordShape("😀".repeat(11))).toEqual([
      { code: "too_short", message: PASSWORD_TOO_SHORT_MESSAGE },
    ]);
  });
});

describe("strongPasswordSchema", () => {
  it("accepts a lowercase passphrase", () => {
    expect(schemaMessages("tidal harbor lantern")).toEqual([]);
  });

  it("rejects a short password with the length message", () => {
    expect(schemaMessages("Rentify123!")).toEqual([PASSWORD_TOO_SHORT_MESSAGE]);
  });

  it("rejects an over-long password with the byte message", () => {
    expect(schemaMessages("a".repeat(73))).toEqual([PASSWORD_TOO_LONG_MESSAGE]);
  });

  it("still rejects unsafe markup", () => {
    expect(schemaMessages("<script>alert(1)</script>")).toEqual([
      UNSAFE_AUTH_INPUT_MESSAGE,
    ]);
  });

  // `POST /auth/password/check` reports from `checkPasswordShape`; a submit is
  // validated by the schema. They must agree, or the check would call a
  // password acceptable that the submit then refuses.
  it.each([
    "tidal-harbor-lantern",
    "Rentify123!",
    "a".repeat(73),
    "<b>tidal-harbor-lantern</b>",
    "tidal &lt;harbor&gt; lantern",
    "javascript:alert-the-harbor",
    "Monday=fun-and-games",
    "<b>x</b>",
    "😀".repeat(19),
  ])("agrees with checkPasswordShape on %s", (value) => {
    expect(schemaMessages(value)).toEqual(
      checkPasswordShape(value).map((issue) => issue.message),
    );
  });
});
