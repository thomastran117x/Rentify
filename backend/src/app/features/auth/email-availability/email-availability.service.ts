import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { EmailAvailabilityResult } from "@/features/auth/email-availability/email-availability.model";
import type { PendingSignupStore } from "@/features/auth/pending-signup/pending-signup.store";
import type { EmailChangeRevertRepository } from "@/features/auth/email-change/email-change-revert.repository";
import type { EmailChangeStore } from "@/features/auth/email-change/email-change.store";
import type { Uuid } from "@/configuration/validation/uuid";

/**
 * Whether an address can be claimed, for the email-change flow.
 *
 * There is deliberately no public endpoint over this. Signup answers a new
 * address and a registered one the same way so it cannot be used to discover
 * who has an account, and a public "is this taken?" check would undo that.
 * Only a signed-in caller moving their own address is told, behind step-up and
 * the auth-sensitive rate limit.
 */
export class EmailAvailabilityService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly pendingSignupStore: PendingSignupStore,
    private readonly emailChangeStore: EmailChangeStore,
    private readonly emailChangeRevertRepository: EmailChangeRevertRepository,
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

    // A signed-in user part-way through moving to this address holds it just as
    // firmly as a row does, and unlike a signup they have already proved the
    // account is theirs. Reported as `taken` rather than a reason of its own so
    // the result shape stays the same: distinguishing "someone owns this" from
    // "someone is claiming this" would tell a caller something they have no use
    // for and an attacker something they do.
    const changeOwnerId =
      await this.emailChangeStore.readAddressHolder(normalizedEmail);

    if (changeOwnerId && changeOwnerId !== allowedUserId) {
      return {
        email: normalizedEmail,
        available: false,
        reason: "taken",
      };
    }

    // An address an account just left stays reserved while its revert link is
    // open, so that link can always put it back. Also `taken`, for the same
    // reason as above.
    if (
      await this.emailChangeRevertRepository.isAddressHeld(
        normalizedEmail,
        allowedUserId,
      )
    ) {
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
}
