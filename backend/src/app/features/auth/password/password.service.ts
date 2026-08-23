import ConflictError from "@/errors/http/conflict.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { AuthRepository } from "@/features/auth/auth.repository";
import type {
  AuthSessionResult,
  AuthUserRecord,
} from "@/features/auth/auth.model";
import {
  isEligibleForLocalPasswordManagement,
  requireEligibleLocalPasswordUser,
  requirePasswordlessLinkedUser,
} from "@/features/auth/local-account-eligibility";
import {
  hashPassword,
  rejectIfPasswordMatchesCurrent,
  verifyPassword,
} from "@/features/auth/password-hashing";
import { LoginLockoutService } from "@/features/auth/lockout/login-lockout.service";
import { OtpService } from "@/features/auth/otp/otp.service";
import { LOCAL_PASSWORD_RESET_OTP_PURPOSE } from "@/features/auth/otp/otp-purposes";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";
import { AuthSessionService } from "@/features/auth/session/session.service";
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  ResendForgotPasswordInput,
  ResetPasswordInput,
  SetPasswordInput,
} from "@/features/auth/password/password.model";

/**
 * Every way a local password is set: recovered by emailed code, changed with
 * the current one, or added to an account that has only ever used a provider.
 *
 * They share a tail — write the hash, rotate the token version so other
 * sessions die, clear any login lockout, and hand back a fresh session — which
 * is why they belong together rather than split across "recovery" and
 * "management".
 */
export class PasswordService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly otpService: OtpService,
    private readonly authSessionService: AuthSessionService,
    private readonly loginLockoutService: LoginLockoutService,
    private readonly publicOtpService: PublicOtpService,
  ) {}

  async forgotPassword(input: ForgotPasswordInput): Promise<{
    accepted: true;
  }> {
    return this.requestPasswordResetCode(input, "forgot-password");
  }

  async resendForgotPassword(input: ResendForgotPasswordInput): Promise<{
    accepted: true;
  }> {
    return this.requestPasswordResetCode(input, "resend-forgot-password");
  }

  async resetPassword(input: ResetPasswordInput): Promise<AuthSessionResult> {
    const user = await this.authRepository.findUserByUsername(input.username);

    await this.otpService.verify({
      purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
      subject: this.resolvePasswordResetOtpSubject(user, input.username),
      code: input.code,
    });

    const eligibleUser = requireEligibleLocalPasswordUser(
      user,
      "This account cannot reset a password.",
    );
    const passwordHash = await hashPassword(input.newPassword);

    await rejectIfPasswordMatchesCurrent(
      input.newPassword,
      eligibleUser.passwordHash,
    );

    return this.applyNewPassword(eligibleUser, passwordHash, input);
  }

  async changePassword(input: ChangePasswordInput): Promise<AuthSessionResult> {
    const user = requireEligibleLocalPasswordUser(
      await this.authRepository.findUserById(input.userId),
      "This account cannot change a password.",
    );
    const isPasswordValid = await verifyPassword(
      input.currentPassword,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedError("Current password is incorrect.");
    }

    await rejectIfPasswordMatchesCurrent(input.newPassword, user.passwordHash);

    const passwordHash = await hashPassword(input.newPassword);

    return this.applyNewPassword(user, passwordHash, input);
  }

  /**
   * Adds local password sign-in to an account that only has social providers.
   * There is no current password to re-enter, so the caller must have already
   * satisfied the `mfa-management` step-up guard.
   */
  async setPassword(input: SetPasswordInput): Promise<AuthSessionResult> {
    const user = requirePasswordlessLinkedUser(
      await this.authRepository.findUserById(input.userId),
    );

    const passwordHash = await hashPassword(input.newPassword);
    // The guard above is advisory: this conditional write is what actually
    // decides the race, so concurrent submissions cannot both rotate the token
    // version and strand each other's session.
    const created = await this.authRepository.setPasswordHashIfUnset(
      user.id,
      passwordHash,
    );

    if (!created) {
      throw new ConflictError(
        "This account already has a password. Use the change password option instead.",
      );
    }

    return this.finishPasswordWrite(user, passwordHash, input);
  }

  /**
   * Always reports acceptance, so the endpoint cannot be used to discover which
   * usernames exist or which of them use a local password.
   */
  private async requestPasswordResetCode(
    input: ForgotPasswordInput | ResendForgotPasswordInput,
    flow: string,
  ): Promise<{ accepted: true }> {
    const rateLimitResult = await this.publicOtpService.consumeRateLimit({
      purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
      subject: input.username,
      client: input.client,
      deviceId: input.deviceId,
      flow,
    });

    if (!rateLimitResult.allowed) {
      this.publicOtpService.logSuspicious(rateLimitResult);
      return {
        accepted: true,
      };
    }

    const user = await this.authRepository.findUserByUsername(input.username);

    if (user && isEligibleForLocalPasswordManagement(user)) {
      await this.publicOtpService.sendPasswordResetCode(user);
    }

    return {
      accepted: true,
    };
  }

  /**
   * A password reset with no account behind it still has to consume an OTP
   * attempt, so the response time does not reveal that the username is unknown.
   */
  private resolvePasswordResetOtpSubject(
    user: AuthUserRecord | null,
    username: string,
  ): string {
    return user?.email ?? `auth:missing-password-reset:${username}`;
  }

  private async applyNewPassword(
    user: AuthUserRecord,
    passwordHash: string,
    input: { client: ResetPasswordInput["client"]; deviceId?: string },
  ): Promise<AuthSessionResult> {
    await this.authRepository.updatePasswordHash(user.id, passwordHash);
    return this.finishPasswordWrite(user, passwordHash, input);
  }

  /**
   * Rotating the token version invalidates every other session, which is the
   * point of changing a password after a suspected compromise.
   */
  private async finishPasswordWrite(
    user: AuthUserRecord,
    passwordHash: string,
    input: { client: ResetPasswordInput["client"]; deviceId?: string },
  ): Promise<AuthSessionResult> {
    const nextTokenVersion = await this.authRepository.rotateTokenVersion(
      user.id,
    );
    await this.loginLockoutService.clearAttemptRecord(user.profile.username);

    const updatedUser: AuthUserRecord = {
      ...user,
      passwordHash,
      tokenVersion: nextTokenVersion,
    };

    return this.authSessionService.reissueSessionForUser(
      updatedUser,
      input.client,
      input.deviceId,
    );
  }
}
