import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMON_PASSWORDS_PATH = join(
  process.cwd(),
  "resources",
  "common-passwords.txt",
);

/** Shorter cores are too generic to reject on: "abc1234567890" is not "abc". */
const MIN_CORE_LENGTH = 4;

export function parseCommonPasswordList(source: string): Set<string> {
  const entries = new Set<string>();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim().toLowerCase();

    if (line && !line.startsWith("#")) {
      entries.add(line);
    }
  }

  return entries;
}

/** The password with any digits and symbols at either end removed. */
function letterCore(password: string): string {
  return password.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** Between two digits, 9 wraps round to 0 in either direction. */
function stepBetween(from: number, to: number): number {
  if (isAsciiDigit(from) && isAsciiDigit(to)) {
    const forward = (to - from + 10) % 10;

    return forward === 9 ? -1 : forward;
  }

  return to - from;
}

/**
 * Every step between neighbouring characters is the same 0 or ±1, as in
 * "aaaaaaaaaaaa", "abcdefghijkl", "123456789012" or "987654321098".
 */
function isTrivialSequence(password: string): boolean {
  const codes = [...password.toLowerCase()].map(
    (char) => char.codePointAt(0) ?? 0,
  );

  if (codes.length < 2) {
    return false;
  }

  const step = stepBetween(codes[0] ?? 0, codes[1] ?? 0);

  if (Math.abs(step) > 1) {
    return false;
  }

  return codes
    .slice(2)
    .every((code, index) => stepBetween(codes[index + 1] ?? 0, code) === step);
}

/** The shortest unit the password repeats, as "trustno1" in "trustno1trustno1". */
function repeatedUnit(password: string): string | null {
  const chars = [...password];

  for (let size = 1; size <= chars.length / 2; size += 1) {
    if (chars.length % size !== 0) {
      continue;
    }

    const unit = chars.slice(0, size).join("");

    if (unit.repeat(chars.length / size) === password) {
      return unit;
    }
  }

  return null;
}

export type CommonPasswordMatcher = (password: string) => boolean;

/**
 * Rejects an entry on the list, an entry with digits or symbols added at
 * either end ("Password1234!", "monkey123456"), a trivial run, or a short unit
 * repeated to make up the length.
 */
export function createCommonPasswordMatcher(
  entries: ReadonlySet<string>,
): CommonPasswordMatcher {
  const isListed = (value: string) => {
    const lower = value.toLowerCase();
    const core = letterCore(lower);

    return (
      entries.has(lower) ||
      (core.length >= MIN_CORE_LENGTH && entries.has(core))
    );
  };

  return (password) => {
    if (isListed(password) || isTrivialSequence(password)) {
      return true;
    }

    const unit = repeatedUnit(password.toLowerCase());

    return (
      unit !== null &&
      (unit.length <= MIN_CORE_LENGTH ||
        isListed(unit) ||
        isTrivialSequence(unit))
    );
  };
}

let defaultMatcher: CommonPasswordMatcher | undefined;

/** Reads the bundled list on first use rather than at import. */
export function isCommonPassword(password: string): boolean {
  defaultMatcher ??= createCommonPasswordMatcher(
    parseCommonPasswordList(readFileSync(COMMON_PASSWORDS_PATH, "utf8")),
  );

  return defaultMatcher(password);
}
