import ConflictError from "@/errors/http/conflict.error";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import { USERNAME_REMINDER_RATE_LIMIT_PURPOSE } from "@/features/auth/otp/otp-purposes";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";
import { PendingSignupStore } from "@/features/auth/pending-signup/pending-signup.store";
import type { UsernameBloomService } from "@/features/auth/username-bloom/username-bloom.service";
import type {
  ForgotUsernameInput,
  UsernameAvailabilityResult,
} from "@/features/auth/username/username.model";

/**
 * Everything keyed by username: whether a name can be claimed, and reminding
 * someone of the one they already have.
 */
export class UsernameService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usernameBloomService: UsernameBloomService,
    private readonly pendingSignupStore: PendingSignupStore,
    private readonly publicOtpService: PublicOtpService,
  ) {}

  /**
   * Whether `username` can be claimed. A name is taken when it belongs to
   * another account, or when it is soft-reserved by another person's
   * not-yet-verified signup.
   *
   * `allowedUserId` / `allowedPendingEmail` exempt the caller's own claim, so a
   * signed-in user checking their current username is told it is available
   * rather than taken.
   */
  async isUsernameAvailable(
    username: string,
    allowedUserId?: string,
    allowedPendingEmail?: string,
  ): Promise<UsernameAvailabilityResult> {
    const normalizedUsername = username.trim().toLowerCase();
    const existingUserId =
      await this.usersRepository.findUserIdByUsername(normalizedUsername);

    if (existingUserId && existingUserId !== allowedUserId) {
      return {
        username: normalizedUsername,
        available: false,
        reason: "taken",
      };
    }

    const pendingSignupEmail =
      await this.pendingSignupStore.readEmailByUsername(normalizedUsername);

    if (pendingSignupEmail && pendingSignupEmail !== allowedPendingEmail) {
      return {
        username: normalizedUsername,
        available: false,
        reason: "taken",
      };
    }

    return { username: normalizedUsername, available: true, reason: null };
  }

  /**
   * The availability endpoint's entry point, as opposed to
   * {@link isUsernameAvailable} which every write path uses.
   *
   * Typing into a username field fires one of these per keystroke, and the
   * answer is "free" almost every time. The bloom filter settles that common
   * case from memory; anything it cannot rule out falls through to the
   * authoritative lookup below, so a false positive costs a query rather than a
   * wrong answer.
   *
   * Write paths deliberately do not come through here. Skipping their database
   * check would trade a clear "that username is taken" for a unique-constraint
   * violation surfaced later, which is a worse error for the same saving.
   */
  async resolveUsernameAvailabilityHint(
    username: string,
    allowedUserId?: string,
    allowedPendingEmail?: string,
  ): Promise<UsernameAvailabilityResult> {
    const normalizedUsername = username.trim().toLowerCase();

    if (
      this.usernameBloomService.check(normalizedUsername) ===
      "definitely-absent"
    ) {
      return {
        username: normalizedUsername,
        available: true,
        reason: null,
      };
    }

    return this.isUsernameAvailable(
      normalizedUsername,
      allowedUserId,
      allowedPendingEmail,
    );
  }

  async assertUsernameIsAvailable(
    username: string,
    allowedUserId?: string,
    allowedPendingEmail?: string,
  ): Promise<void> {
    const result = await this.isUsernameAvailable(
      username,
      allowedUserId,
      allowedPendingEmail,
    );

    if (!result.available) {
      throw new ConflictError("That username is already taken.", {
        field: "username",
      });
    }
  }

  /**
   * Always reports acceptance, whether or not the address has an account, so the
   * endpoint cannot be used to test which emails are registered.
   */
  async forgotUsername(input: ForgotUsernameInput): Promise<{
    accepted: true;
  }> {
    const rateLimitResult = await this.publicOtpService.consumeRateLimit({
      purpose: USERNAME_REMINDER_RATE_LIMIT_PURPOSE,
      subject: input.email,
      client: input.client,
      deviceId: input.deviceId,
      flow: "forgot-username",
    });

    if (!rateLimitResult.allowed) {
      this.publicOtpService.logSuspicious(rateLimitResult);
      return {
        accepted: true,
      };
    }

    const user = await this.usersRepository.findUserByEmail(input.email);

    if (user) {
      await this.publicOtpService.sendUsernameReminder(user);
    }

    return {
      accepted: true,
    };
  }
}
