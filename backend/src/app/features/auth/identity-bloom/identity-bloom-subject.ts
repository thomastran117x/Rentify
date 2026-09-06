/**
 * What makes one identity bloom filter different from another.
 *
 * Everything else in this module — the sizing math, the bit array, the Redis
 * gateway, the read service, the rebuild — is the same code for every subject.
 * The four fields below are the whole of the difference, which is what lets
 * usernames and emails share one implementation instead of two.
 */

import {
  normalizeEmailForBloom,
  normalizeUsernameForBloom,
  type BloomNormalizer,
} from "@/features/auth/identity-bloom/bloom-hash";
import { PENDING_LOCAL_SIGNUP_CACHE_PREFIX } from "@/features/auth/pending-signup-keys";
import { PENDING_LOCAL_SIGNUP_USERNAME_CACHE_PREFIX } from "@/features/auth/pending-signup-username";

export type IdentityBloomSubjectId = "username" | "email";

export interface IdentityBloomSubject {
  /** Labels log lines and metrics so two filters can be told apart. */
  id: IdentityBloomSubjectId;
  /** Root of this subject's Redis keyspace. */
  cachePrefix: string;
  /** Must agree with the unique index; see the notes in `bloom-hash.ts`. */
  normalize: BloomNormalizer;
  /**
   * Prefix of the cache keys holding not-yet-verified signup reservations,
   * whose suffix is the reserved value. A rebuild folds these in so a value
   * that is soft-reserved rather than persisted still reads as present.
   */
  reservationPrefix: string;
}

/**
 * The literal prefix predates the rename of this module and is deliberately
 * left alone: changing it would move the deployed filter to a fresh keyspace
 * and cold-start every instance for nothing.
 */
export const USERNAME_BLOOM_CACHE_PREFIX = "auth:username-bloom";
export const EMAIL_BLOOM_CACHE_PREFIX = "auth:email-bloom";

export const usernameBloomSubject: IdentityBloomSubject = {
  id: "username",
  cachePrefix: USERNAME_BLOOM_CACHE_PREFIX,
  normalize: normalizeUsernameForBloom,
  reservationPrefix: PENDING_LOCAL_SIGNUP_USERNAME_CACHE_PREFIX,
};

export const emailBloomSubject: IdentityBloomSubject = {
  id: "email",
  cachePrefix: EMAIL_BLOOM_CACHE_PREFIX,
  normalize: normalizeEmailForBloom,
  reservationPrefix: PENDING_LOCAL_SIGNUP_CACHE_PREFIX,
};
