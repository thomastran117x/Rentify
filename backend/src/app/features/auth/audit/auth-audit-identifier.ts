import { createHmac } from "node:crypto";

/**
 * Normalizes a typed sign-in identifier (a username, or an email on the unlock
 * routes) the way sign-in itself compares them, so `Owner-One` and `owner-one `
 * hash alike.
 */
export function normalizeAuthIdentifier(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

/**
 * A keyed hash of the identifier, as 64 hex characters. Keyed rather than a
 * plain digest so the audit table cannot be reversed by hashing a list of
 * likely usernames without the server secret, while equal identifiers still
 * produce equal hashes and stay correlatable.
 */
export function hashAuthIdentifier(value: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(normalizeAuthIdentifier(value))
    .digest("hex");
}
