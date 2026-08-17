/**
 * A local signup soft-reserves its username in the cache for as long as the
 * verification OTP is alive, so two people cannot verify their way onto the same
 * name. The reservation is keyed by username and holds the pending signup's
 * email.
 *
 * The key lives here rather than on AuthService because the profile rename path
 * has to honour the same reservation: without it, the availability endpoint
 * would report a name as free that signup would go on to reject.
 */

export const PENDING_LOCAL_SIGNUP_USERNAME_CACHE_PREFIX =
  "auth:pending-signup-username";

export function getPendingSignupUsernameKey(username: string): string {
  return `${PENDING_LOCAL_SIGNUP_USERNAME_CACHE_PREFIX}:${username.trim().toLowerCase()}`;
}
