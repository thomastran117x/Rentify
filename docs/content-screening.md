# Content screening

`ContentSanitizationService` (`backend/src/app/features/security/content-sanitization.service.ts`) screens user-authored text for control characters, unsafe markup, injection markers, profanity, slurs and impersonation usernames.

- `inspect` covers prose: posting text, reports, blog comments.
- `inspectUsername` covers username claims and availability checks. Any hit comes back as `reason: "inappropriate"`.
- `inspectRequest` covers raw request bodies, query strings and route params. It only checks control characters and markup.

## Term bank

The profanity and reserved-name terms live in `backend/resources/content-screening-terms.txt`, not in code. The file is read once when the backend starts. A missing or malformed file stops startup, and the Docker image copies it in with `COPY resources ./resources`.

Format: `#` comments, `[section]` headers, one lowercase `a-z` term per line, and no duplicates within a section.

| Section                | Prose (`inspect`)                         | Usernames (`inspectUsername`)                       |
| ---------------------- | ----------------------------------------- | --------------------------------------------------- |
| `[substrings]`         | anywhere, including inside longer words   | anywhere in the name, separators and digits removed |
| `[words]`              | whole word only                           | whole segment, or the whole name                    |
| `[reserved-usernames]` | not checked                               | whole segment, or the whole name                    |
| `[allow]`              | masked out before `[substrings]` matching | masked out before `[substrings]` matching           |

Curation rules:

- Prose screening must never block an ordinary listing. Put a term in `[substrings]` only if it can't appear inside a common English word or place name. Short or ambiguous terms (`ass`, `tit`, `cock`) belong in `[words]`.
- When a real word contains a `[substrings]` term (`scunthorpe`, `shiitake`, `retardant`), add it to `[allow]`. Don't weaken the term. The parser rejects an `[allow]` entry that contains no blocked term, or that is also listed as blocked.
- List each term once in its plain spelling. Normalization handles the disguised variants.

## Normalization

Matching runs on a detection-only copy of the text (`content-screening-normalization.ts`):

1. NFKC, lowercase, strip accents and invisible format characters (zero-width spaces, soft hyphens), and fold common Cyrillic and Greek lookalike letters to Latin.
2. Leetspeak (`0 1 3 4 5 7 8 @ $`, plus `! | +` when between two characters), applied only inside chunks that already contain a letter. Prices and unit numbers are left alone.
3. Prose only: join runs of three or more spaced-out single letters (`f u c k`, `s.h.i.t`). A second variant also joins runs of one- and two-character fragments that include a lone character (`f.u.ck`, `s.h.it`, `sh 1 t`). That variant is screened alongside the primary spelling, never instead of it, because it also runs short ordinary words together.
4. Cap repeated letters at two. Every term pattern lets each letter repeat, so `fuuuck` matches `fuck` but `bob` never matches `boob`.

Markup, injection and control-character checks still run on the original value.

## Tests

`backend/src/test/features/security/` covers the parser, normalization and the service. It also checks that every username-suggestion word, seeded username and seeded posting text passes screening. Run those tests after editing the term bank.
