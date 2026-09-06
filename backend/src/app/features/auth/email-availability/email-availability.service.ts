import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { IdentityBloomService } from "@/features/auth/identity-bloom/identity-bloom.service";
import type { EmailAvailabilityResult } from "@/features/auth/email-availability/email-availability.model";
import type { PendingSignupStore } from "@/features/auth/pending-signup/pending-signup.store";
import type { Uuid } from "@/configuration/validation/uuid";

/**
 * Whether a signup can use an address, for the availability endpoint.
 *
 * Signup itself does not come through here. It has to reach the database
 * anyway, and answering from a filter would trade a clear response for a
 * unique-constraint violation surfaced later — the same reasoning that keeps
 * the username write paths out of `resolveUsernameAvailabilityHint`.
 */
export class EmailAvailabilityService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly emailBloomService: IdentityBloomService,
    private readonly pendingSignupStore: PendingSignupStore,
  ) {}

  /**
   * The authoritative answer.
   *
   * `allowedUserId` exempts the caller's own address, so a signed-in user
   * checking the address they already hold is told it is available rather than
   * taken.
   */
  async isEmailAvailable(
    email: string,
    allowedUserId?: Uuid,
  ): Promise<EmailAvailabilityResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const existingUserId =
      await this.usersRepository.findUserIdByEmail(normalizedEmail);

    if (existingUserId && existingUserId !== allowedUserId) {
      return {
        email: normalizedEmail,
        available: false,
        reason: "taken",
      };
    }

    const pendingSignup = await this.pendingSignupStore.read(normalizedEmail);

    if (pendingSignup) {
      return {
        email: normalizedEmail,
        available: true,
        reason: "pending-verification",
      };
    }

    return { email: normalizedEmail, available: true, reason: null };
  }

  /**
   * The endpoint's entry point.
   *
   * Typing into an email field fires one of these per keystroke, and the answer
   * is "free" almost every time. The bloom filter settles that common case from
   * memory; anything it cannot rule out falls through to the authoritative
   * lookup above, so a false positive costs a query rather than a wrong answer.
   *
   * The filter holds pending reservations as well as persisted addresses, which
   * is what makes the fast path safe to take: were it only a mirror of `users`,
   * a `definitely-absent` verdict would report `reason: null` for an address
   * whose signup is already in flight.
   */
  async resolveEmailAvailabilityHint(
    email: string,
    allowedUserId?: Uuid,
  ): Promise<EmailAvailabilityResult> {
    const normalizedEmail = email.trim().toLowerCase();

    if (this.emailBloomService.check(normalizedEmail) === "definitely-absent") {
      return {
        email: normalizedEmail,
        available: true,
        reason: null,
      };
    }

    return this.isEmailAvailable(normalizedEmail, allowedUserId);
  }
}
