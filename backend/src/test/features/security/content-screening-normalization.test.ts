import {
  capRepeatedLetters,
  joinSpacedLetters,
  normalizeForScreening,
  prepareProseForScreening,
  prepareUsernameForScreening,
  substituteLeetCharacters,
} from "@/features/security/content-screening-normalization";

describe("content screening normalization", () => {
  it.each([
    ["\uFF26\uFF35\uFF23\uFF2B", "fuck"],
    ["sh\u200Bit", "shit"],
    ["sh\u00EFt", "shit"],
    ["\u0421unt", "cunt"],
    ["\u03BA\u03B9\u03BA\u0435", "kike"],
    ["Bright Loft", "bright loft"],
  ])("normalizes %j to %j", (value, expected) => {
    expect(normalizeForScreening(value)).toBe(expected);
  });

  it("substitutes leetspeak inside chunks that contain a letter", () => {
    expect(substituteLeetCharacters("sh1t $hit a$$ sh!t")).toBe(
      "shit shit ass shit",
    );
  });

  it("leaves numbers and trailing punctuation alone", () => {
    expect(substituteLeetCharacters("$1200 per month, unit 4827! wow!")).toBe(
      "$1200 per month, unit 4827! wow!",
    );
  });

  it("joins runs of spaced-out single letters", () => {
    expect(joinSpacedLetters("f u c k off")).toBe("fuck off");
    expect(joinSpacedLetters("s.h.i.t")).toBe("shit");
    expect(joinSpacedLetters("a big fan of it")).toBe("a big fan of it");
  });

  it("caps repeated letters at two", () => {
    expect(capRepeatedLetters("fuuuuck")).toBe("fuuck");
    expect(capRepeatedLetters("boob")).toBe("boob");
  });

  it("prepares prose through every step", () => {
    expect(prepareProseForScreening("F U C K  sh1iiiit")).toBe("fuck  shiit");
  });

  it("prepares usernames as collapsed letters and segments", () => {
    expect(prepareUsernameForScreening("Admin_1")).toEqual({
      collapsed: "admin",
      segments: ["admin"],
    });

    const forms = prepareUsernameForScreening("admin1-sh1t");

    expect(forms.collapsed).toBe("adminishit");
    expect(forms.segments).toEqual(
      expect.arrayContaining(["admini", "admin", "shit", "sh", "t"]),
    );
  });
});
