import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUsernameSuggestionVocabulary } from "@/features/auth/username/username-suggestions";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import {
  compileContentScreeningTerms,
  loadContentScreeningTerms,
  parseContentScreeningTerms,
} from "@/features/security/content-screening-terms";
import { SEED_POSTINGS } from "@/seeds/fixtures/postings";
import { SEED_USERS } from "@/seeds/fixtures/users";

const MINIMAL_BANK =
  "[substrings]\nzorp\n[words]\nblap\n[reserved-usernames]\nboss\n";
const NON_PROSE_KEYS = new Set([
  "id",
  "blobUrl",
  "blobName",
  "thumbnailBlobUrl",
  "thumbnailBlobName",
  "ownerEmail",
]);

function collectProse(
  value: unknown,
  path: string,
  into: Array<{ path: string; value: string }>,
): void {
  if (typeof value === "string") {
    into.push({ path, value });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectProse(entry, `${path}.${index}`, into),
    );
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => {
      if (!NON_PROSE_KEYS.has(key)) {
        collectProse(entry, path ? `${path}.${key}` : key, into);
      }
    });
  }
}

describe("content screening terms", () => {
  const service = new ContentSanitizationService();

  it("loads a broad term bank from the text resource", () => {
    const terms = parseContentScreeningTerms(
      readFileSync(
        join(process.cwd(), "resources", "content-screening-terms.txt"),
        "utf8",
      ),
    );

    expect(terms.substrings.length + terms.words.length).toBeGreaterThanOrEqual(
      150,
    );
    expect(terms.reservedUsernames.length).toBeGreaterThanOrEqual(20);
    expect(terms.allow.length).toBeGreaterThan(0);
    expect(loadContentScreeningTerms().substring.test("fuck")).toBe(true);
  });

  it("parses comments, blank lines and CRLF line endings", () => {
    expect(
      parseContentScreeningTerms(
        "# header\r\n\r\n[substrings]\r\nzorp\r\n[words]\r\nblap\r\n[reserved-usernames]\r\nboss\r\n[allow]\r\nzorpish\r\n",
      ),
    ).toEqual({
      substrings: ["zorp"],
      words: ["blap"],
      reservedUsernames: ["boss"],
      allow: ["zorpish"],
    });
  });

  it.each([
    ["zorp\n[words]\nblap", "must follow a section header"],
    [`[swears]\nzorp\n${MINIMAL_BANK}`, "Unknown content screening section"],
    [
      "[substrings]\nzorp-ish\n[words]\nblap\n[reserved-usernames]\nboss",
      "Invalid content screening term",
    ],
    [
      "[substrings]\nZorp\n[words]\nblap\n[reserved-usernames]\nboss",
      "Invalid content screening term",
    ],
    [`${MINIMAL_BANK}[substrings]\nzorp`, "Duplicate content screening term"],
    [
      "[substrings]\nzorp\n[reserved-usernames]\nboss",
      "must include substrings, words and reserved usernames",
    ],
    [`${MINIMAL_BANK}[allow]\nboss`, "both allowed and blocked"],
    [`${MINIMAL_BANK}[allow]\nharmless`, "contains no blocked term"],
  ])("rejects a malformed bank (%j)", (source, message) => {
    expect(() => parseContentScreeningTerms(source)).toThrow(message);
  });

  it("compiles without an allow section", () => {
    expect(
      compileContentScreeningTerms(parseContentScreeningTerms(MINIMAL_BANK))
        .allow,
    ).toBeNull();
  });

  it("lets every allowed word through both profiles", () => {
    const { allow } = parseContentScreeningTerms(
      readFileSync(
        join(process.cwd(), "resources", "content-screening-terms.txt"),
        "utf8",
      ),
    );

    for (const word of allow) {
      expect(service.inspect([{ path: "body", value: word }])).toEqual([]);
      expect(
        service.inspectUsername([{ path: "username", value: word }]),
      ).toEqual([]);
    }
  });

  it("never blocks a username suggestion word", () => {
    const vocabulary = parseUsernameSuggestionVocabulary(
      readFileSync(
        join(process.cwd(), "resources", "username-suggestion-words.txt"),
        "utf8",
      ),
    );
    const blocked = [...vocabulary.adjectives, ...vocabulary.nouns].filter(
      (word) =>
        service.inspectUsername([{ path: "username", value: word }]).length > 0,
    );

    expect(blocked).toEqual([]);
  });

  it("never blocks a seeded non-admin username", () => {
    // Site admins legitimately hold reserved names such as `admin-one`; an
    // account's existing username is exempt from screening in UsernameService.
    const blocked = SEED_USERS.filter((user) => user.role !== "admin")
      .map((user) => user.username)
      .filter(
        (username) =>
          service.inspectUsername([{ path: "username", value: username }])
            .length > 0,
      );

    expect(blocked).toEqual([]);
  });

  it("never blocks seeded posting text", () => {
    const inputs: Array<{ path: string; value: string }> = [];
    collectProse(SEED_POSTINGS, "", inputs);

    expect(inputs.length).toBeGreaterThan(100);
    expect(service.inspect(inputs)).toEqual([]);
  });
});
