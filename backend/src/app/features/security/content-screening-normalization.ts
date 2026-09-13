/**
 * Detection-only transforms applied before matching the content screening term
 * bank. The output is never stored or shown: it exists so that trivial
 * disguises — lookalike letters, leetspeak, spaced-out or stretched letters —
 * land on the same spelling as the term they hide.
 */

const CONFUSABLE_LETTERS: Readonly<Record<string, string>> = {
  // Cyrillic
  "\u0430": "a",
  "\u0435": "e",
  "\u0456": "i",
  "\u0458": "j",
  "\u043A": "k",
  "\u043E": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0443": "y",
  "\u0445": "x",
  "\u0455": "s",
  "\u04BB": "h",
  "\u0501": "d",
  "\u051B": "q",
  "\u051D": "w",
  // Greek
  "\u03B1": "a",
  "\u03B9": "i",
  "\u03BA": "k",
  "\u03BD": "v",
  "\u03BF": "o",
  "\u03C1": "p",
  "\u03C5": "u",
  "\u03C7": "x",
  // Latin dotless i
  "\u0131": "i",
};
const LEET_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "l",
  "+": "t",
};

const COMBINING_MARK_PATTERN = /\p{M}/gu;
const FORMAT_CHARACTER_PATTERN = /\p{Cf}/gu;
const CONFUSABLE_LETTER_PATTERN = new RegExp(
  `[${Object.keys(CONFUSABLE_LETTERS).join("")}]`,
  "gu",
);
const LEET_CHUNK_PATTERN = /[\p{L}\p{N}@$!|+]+/gu;
const LETTER_PATTERN = /\p{L}/u;
// `!`, `|` and `+` are ordinary punctuation at the edge of a word ("wow!"), so
// they only stand in for a letter when wedged between two characters.
const EMBEDDED_LEET_PUNCTUATION_PATTERN =
  /(?<=[\p{L}\p{N}])[!|+](?=[\p{L}\p{N}])/gu;
const LEET_CHARACTER_PATTERN = /[0134578@$]/g;
const SPACED_LETTERS_PATTERN =
  /(?<![\p{L}\p{N}])\p{L}(?:[\s.\-_*]+\p{L}(?![\p{L}\p{N}])){2,}/gu;
const SPACED_LETTER_SEPARATOR_PATTERN = /[\s.\-_*]+/gu;
const REPEATED_LETTER_PATTERN = /(\p{L})\1{2,}/gu;
const NON_LETTER_RUN_PATTERN = /[^\p{L}]+/u;
const NON_LETTER_PATTERN = /[^\p{L}]/gu;

/**
 * Folds compatibility forms (fullwidth, mathematical letters), case, accents,
 * invisible format characters and common Cyrillic/Greek lookalikes onto plain
 * lowercase Latin letters.
 */
export function normalizeForScreening(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARK_PATTERN, "")
    .replace(FORMAT_CHARACTER_PATTERN, "")
    .replace(
      CONFUSABLE_LETTER_PATTERN,
      (letter) => CONFUSABLE_LETTERS[letter] ?? letter,
    );
}

/**
 * Reads digits and symbols as the letters they imitate, but only inside a
 * chunk that already contains a letter, so prices, unit numbers and the numeric
 * suffix of a suggested username are left alone.
 */
export function substituteLeetCharacters(value: string): string {
  return value.replace(LEET_CHUNK_PATTERN, (chunk) => {
    if (!LETTER_PATTERN.test(chunk)) {
      return chunk;
    }

    return chunk
      .replace(
        EMBEDDED_LEET_PUNCTUATION_PATTERN,
        (character) => LEET_SUBSTITUTIONS[character] ?? character,
      )
      .replace(
        LEET_CHARACTER_PATTERN,
        (character) => LEET_SUBSTITUTIONS[character] ?? character,
      );
  });
}

/** Joins three or more single letters split by separators: `f u c k`, `s.h.i.t`. */
export function joinSpacedLetters(value: string): string {
  return value.replace(SPACED_LETTERS_PATTERN, (run) =>
    run.replace(SPACED_LETTER_SEPARATOR_PATTERN, ""),
  );
}

/**
 * Shortens runs of a letter to two. Term patterns accept any repeat count, so
 * this loses no matches, and it bounds regex backtracking on long runs.
 */
export function capRepeatedLetters(value: string): string {
  return value.replace(REPEATED_LETTER_PATTERN, "$1$1");
}

export function prepareProseForScreening(value: string): string {
  return capRepeatedLetters(
    joinSpacedLetters(substituteLeetCharacters(normalizeForScreening(value))),
  );
}

export interface UsernameScreeningForms {
  /** Every letter of the username run together, separators and digits dropped. */
  collapsed: string;
  /** Letter runs between separators, with and without leetspeak substitution. */
  segments: string[];
}

export function prepareUsernameForScreening(
  value: string,
): UsernameScreeningForms {
  const normalized = normalizeForScreening(value);
  const substituted = capRepeatedLetters(substituteLeetCharacters(normalized));
  const segments = new Set(
    [
      ...substituted.split(NON_LETTER_RUN_PATTERN),
      ...capRepeatedLetters(normalized).split(NON_LETTER_RUN_PATTERN),
    ].filter(Boolean),
  );

  return {
    collapsed: capRepeatedLetters(substituted.replace(NON_LETTER_PATTERN, "")),
    segments: [...segments],
  };
}
