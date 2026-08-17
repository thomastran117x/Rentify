/**
 * Sizing math for the username bloom filter.
 *
 * The filter answers "is this username already taken" without touching MySQL.
 * Only one direction of its answer is trusted: a clear bit means the name is
 * *definitely* absent, so the caller can report it available immediately. All
 * bits set means *maybe* present, and the caller falls through to the
 * authoritative database lookup. A false positive therefore costs one extra
 * query and still returns the right answer, which is why the target rate below
 * is a performance dial rather than a correctness one.
 */

import { createHash } from "node:crypto";

/**
 * Bumped whenever the hashing scheme in `bloom-hash.ts` changes. It feeds the
 * fingerprint, so an old bitmap can never be read with new hash functions —
 * that combination would produce false *negatives*, the one failure mode this
 * design cannot tolerate.
 */
export const BLOOM_HASH_VERSION = 1;

const LN_2 = Math.LN2;
const LN_2_SQUARED = LN_2 * LN_2;

export interface BloomParameters {
  /** Total addressable bits. Always a multiple of 8. */
  bitCount: number;
  /** Number of hash probes per value. */
  hashCount: number;
  /** Size of the backing byte array. */
  byteLength: number;
  /**
   * Short digest of the parameters. Embedded in every Redis key so that a
   * configuration change lands on a fresh, empty bitmap instead of
   * misinterpreting one built with different sizing.
   */
  fingerprint: string;
}

/**
 * Standard bloom sizing: `m = -n·ln(p) / (ln2)²` bits and `k = (m/n)·ln2`
 * probes.
 *
 * `bitCount` is rounded up to a whole number of bytes because Redis bitmaps are
 * byte-granular; leaving a partial trailing byte would make the local array and
 * the Redis string disagree on length for no benefit.
 */
export function deriveBloomParameters(
  capacity: number,
  falsePositiveRate: number,
): BloomParameters {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error("Bloom filter capacity must be a positive integer.");
  }

  if (
    !Number.isFinite(falsePositiveRate) ||
    falsePositiveRate <= 0 ||
    falsePositiveRate >= 1
  ) {
    throw new Error(
      "Bloom filter false positive rate must be greater than 0 and less than 1.",
    );
  }

  const rawBitCount = Math.ceil(
    (-capacity * Math.log(falsePositiveRate)) / LN_2_SQUARED,
  );
  const byteLength = Math.max(1, Math.ceil(rawBitCount / 8));
  const bitCount = byteLength * 8;
  const hashCount = Math.max(1, Math.round((bitCount / capacity) * LN_2));

  return {
    bitCount,
    hashCount,
    byteLength,
    fingerprint: buildFingerprint(bitCount, hashCount),
  };
}

function buildFingerprint(bitCount: number, hashCount: number): string {
  return createHash("sha256")
    .update(`v${BLOOM_HASH_VERSION}:${bitCount}:${hashCount}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Expected false positive rate for a filter holding `itemCount` values, used to
 * report saturation after a rebuild. Rises as the filter fills past the
 * capacity it was sized for.
 */
export function estimateFalsePositiveRate(
  parameters: Pick<BloomParameters, "bitCount" | "hashCount">,
  itemCount: number,
): number {
  if (itemCount <= 0) {
    return 0;
  }

  const { bitCount, hashCount } = parameters;
  const bitStillClear = Math.exp((-hashCount * itemCount) / bitCount);

  return (1 - bitStillClear) ** hashCount;
}
