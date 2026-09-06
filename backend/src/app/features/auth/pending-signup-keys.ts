/**
 * Cache keys for the email side of a pending local signup.
 *
 * The record itself is keyed by email and holds the whole signup; the username
 * reservation that points back at it lives in `pending-signup-username.ts`.
 *
 * These live outside `PendingSignupStore` because the email bloom rebuild has
 * to enumerate them: a reservation makes an address occupied in the same way a
 * row does, and a filter that omitted them would report a signup already in
 * flight as though nothing had ever been submitted.
 *
 * Note the trailing colon matters. `auth:pending-signup:*` deliberately does
 * not match `auth:pending-signup-username:*` or `auth:pending-signup-verify:*`,
 * so a scan for reservations picks up records and nothing else.
 */

export const PENDING_LOCAL_SIGNUP_CACHE_PREFIX = "auth:pending-signup";

export function getPendingSignupKey(email: string): string {
  return `${PENDING_LOCAL_SIGNUP_CACHE_PREFIX}:${email.trim().toLowerCase()}`;
}
