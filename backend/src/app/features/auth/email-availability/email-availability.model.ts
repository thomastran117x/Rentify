import { z } from "zod";

export const emailAvailabilityQuerySchema = z.object({
  email: z
    .email("Enter a valid email address.")
    .max(255, "Email must be at most 255 characters.")
    .transform((value) => value.trim().toLowerCase()),
});

export type EmailAvailabilityQuery = z.infer<
  typeof emailAvailabilityQuerySchema
>;

/**
 * Why `pending-verification` is not simply `taken`.
 *
 * A not-yet-verified signup holds a cache reservation, not a row, and
 * `LocalAuthService.localSignup` deliberately accepts an address in that state
 * — otherwise someone who abandoned a signup could never come back and finish
 * it. Reporting it unavailable would block a form the backend would have
 * accepted, so the address stays `available` and the reason carries the nuance
 * the caller needs to explain itself.
 */
export interface EmailAvailabilityResult {
  email: string;
  available: boolean;
  reason: "taken" | "pending-verification" | null;
}
