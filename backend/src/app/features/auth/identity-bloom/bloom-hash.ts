/**
 * Bit-index derivation for the identity bloom filters.
 *
 * Uses Kirsch-Mitzenmacher double hashing: two independent 32-bit values pulled
 * from a single SHA-256 digest generate all `k` probes as `h1 + i·h2`, which is
 * as accurate as `k` independent hashes but costs one digest instead of `k`.
 *
 * SHA-256 is not a security boundary here — the filter only ever holds values
 * the caller already supplied. It is simply the hash this repository already
 * depends on (`node:crypto`), which keeps the filter dependency-free.
 */

import { createHash } from "node:crypto";

/**
 * Folds a value to the form its unique index compares on. Every subject brings
 * its own, because the filter has to agree with the index or a value added one
 * way would be missed when checked another.
 */
export type BloomNormalizer = (value: string) => string;

/**
 * Normalizes exactly the way the unique index does. `profiles.username` is
 * stored lowercased and every lookup lowercases first, so the filter has to
 * agree or a name added as `Kate` would be missed when checked as `kate`.
 */
export function normalizeUsernameForBloom(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The email counterpart. Lowercasing is right here for the same reason it is
 * right for usernames, and for one more: `users_email_key` is declared on a
 * `utf8mb4_unicode_ci` column, so the index itself already treats `A@x.com` and
 * `a@x.com` as the same row. Every write path lowercases before insert
 * (`users.repository.ts`), so folding the same way is what keeps the filter and
 * the index answering the same question.
 *
 * Note this deliberately does not do "smart" email normalization — stripping
 * dots or `+tags` the way some providers do. Those addresses occupy distinct
 * rows, and collapsing them here would make the filter claim a value is present
 * when the index says otherwise.
 */
export function normalizeEmailForBloom(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Derives the `hashCount` bit positions for `value`.
 *
 * The arithmetic stays inside the safe-integer range: `h1` and `h2` are below
 * 2^32 and `i` is small, so `h1 + i·h2` peaks well under 2^53.
 */
export function getBitIndices(
  value: string,
  bitCount: number,
  hashCount: number,
  normalize: BloomNormalizer,
): number[] {
  const digest = createHash("sha256").update(normalize(value)).digest();

  const primary = digest.readUInt32BE(0);
  // Forced odd so that repeatedly adding it cycles through every residue class
  // rather than revisiting a subset, which keeps the probes spread out.
  //
  // The `>>> 0` is not decoration. Bitwise OR in JavaScript yields a *signed*
  // 32-bit result, so any digest with the high bit set would come back negative,
  // push an index negative, and land outside the byte array — where writes are
  // dropped and reads reply zero. That reads as "not present" for a value that
  // was added, which is the false negative this filter must never produce.
  const secondary = (digest.readUInt32BE(4) | 1) >>> 0;

  const indices: number[] = new Array<number>(hashCount);

  for (let probe = 0; probe < hashCount; probe += 1) {
    indices[probe] = (primary + probe * secondary) % bitCount;
  }

  return indices;
}
