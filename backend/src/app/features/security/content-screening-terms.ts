import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONTENT_SCREENING_TERMS_PATH = join(
  process.cwd(),
  "resources",
  "content-screening-terms.txt",
);
const TERM_PATTERN = /^[a-z]+$/;
const SECTIONS = [
  "substrings",
  "words",
  "reserved-usernames",
  "allow",
] as const;

type ContentScreeningSection = (typeof SECTIONS)[number];

export interface ContentScreeningTerms {
  substrings: readonly string[];
  words: readonly string[];
  reservedUsernames: readonly string[];
  allow: readonly string[];
}

export interface CompiledContentScreeningTerms {
  /** A `[substrings]` term anywhere, including inside a longer word. */
  substring: RegExp;
  /** A `[words]` term standing alone as a word. */
  word: RegExp;
  /** A string that is exactly one `[words]` term. */
  exactWord: RegExp;
  /** A string that is exactly one `[reserved-usernames]` term. */
  exactReservedUsername: RegExp;
  /** Every `[allow]` entry, for masking; null when the section is empty. */
  allow: RegExp | null;
}

function isSection(name: string): name is ContentScreeningSection {
  return (SECTIONS as readonly string[]).includes(name);
}

/**
 * Lets every letter repeat, so `fuck` also matches `fuuuck` without collapsing
 * genuine double letters: `boob` still needs two o's and never matches `bob`.
 */
function toRepeatTolerantPattern(term: string): string {
  return [...term].map((letter) => `${letter}+`).join("");
}

function toAlternation(terms: readonly string[]): string {
  return terms.map(toRepeatTolerantPattern).join("|");
}

function compileSubstringPattern(terms: readonly string[]): RegExp {
  return new RegExp(`(?:${toAlternation(terms)})`, "u");
}

export function parseContentScreeningTerms(
  source: string,
): ContentScreeningTerms {
  const entries: Record<ContentScreeningSection, Set<string>> = {
    substrings: new Set<string>(),
    words: new Set<string>(),
    "reserved-usernames": new Set<string>(),
    allow: new Set<string>(),
  };
  let section: ContentScreeningSection | undefined;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      const name = line.slice(1, -1);

      if (!isSection(name)) {
        throw new Error(`Unknown content screening section: ${line}`);
      }

      section = name;
      continue;
    }

    if (!section) {
      throw new Error("Content screening terms must follow a section header.");
    }

    if (!TERM_PATTERN.test(line)) {
      throw new Error(`Invalid content screening term: ${line}`);
    }

    if (entries[section].has(line)) {
      throw new Error(`Duplicate content screening term: ${line}`);
    }

    entries[section].add(line);
  }

  if (
    entries.substrings.size === 0 ||
    entries.words.size === 0 ||
    entries["reserved-usernames"].size === 0
  ) {
    throw new Error(
      "Content screening terms must include substrings, words and reserved usernames.",
    );
  }

  const substringPattern = compileSubstringPattern([...entries.substrings]);

  for (const allowed of entries.allow) {
    if (
      entries.substrings.has(allowed) ||
      entries.words.has(allowed) ||
      entries["reserved-usernames"].has(allowed)
    ) {
      throw new Error(
        `Content screening term is both allowed and blocked: ${allowed}`,
      );
    }

    // An exception that no longer contains a blocked term exempts nothing and
    // would only hide a stale entry.
    if (!substringPattern.test(allowed)) {
      throw new Error(
        `Allowed content screening term contains no blocked term: ${allowed}`,
      );
    }
  }

  return {
    substrings: [...entries.substrings],
    words: [...entries.words],
    reservedUsernames: [...entries["reserved-usernames"]],
    allow: [...entries.allow],
  };
}

export function compileContentScreeningTerms(
  terms: ContentScreeningTerms,
): CompiledContentScreeningTerms {
  return {
    substring: compileSubstringPattern(terms.substrings),
    word: new RegExp(
      `(?<!\\p{L})(?:${toAlternation(terms.words)})(?!\\p{L})`,
      "u",
    ),
    exactWord: new RegExp(`^(?:${toAlternation(terms.words)})$`, "u"),
    exactReservedUsername: new RegExp(
      `^(?:${toAlternation(terms.reservedUsernames)})$`,
      "u",
    ),
    allow:
      terms.allow.length > 0
        ? new RegExp(`(?:${terms.allow.join("|")})`, "gu")
        : null,
  };
}

export function loadContentScreeningTerms(): CompiledContentScreeningTerms {
  return compileContentScreeningTerms(
    parseContentScreeningTerms(
      readFileSync(CONTENT_SCREENING_TERMS_PATH, "utf8"),
    ),
  );
}

/** Loaded at import so a missing or malformed term bank fails startup. */
export const defaultContentScreeningTerms = loadContentScreeningTerms();
