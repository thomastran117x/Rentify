/**
 * Why `pending-verification` is not simply `taken`.
 *
 * A not-yet-verified signup holds a cache reservation, not a row, and
 * `LocalAuthService.localSignup` deliberately accepts an address in that state
 * — otherwise someone who abandoned a signup could never come back and finish
 * it. Reporting it unavailable would block an email change onto an address
 * nobody has verified yet, so the address stays `available` and the reason
 * carries the nuance.
 */
export interface EmailAvailabilityResult {
  email: string;
  available: boolean;
  reason: "taken" | "pending-verification" | null;
}
