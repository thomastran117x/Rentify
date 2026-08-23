import { randomUUID } from "node:crypto";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import LockedError from "@/errors/http/locked.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { DeviceService } from "@/features/auth/device/device.service";
import type { CacheService } from "@/features/cache/cache.service";
import { EmailService } from "@/features/email/email.service";
import { AuthRepository } from "@/features/auth/auth.repository";
import {
  type AuthActiveOrganizationSummary,
  type AuthRequestContext,
  type AuthSessionResult,
  type SignupVerificationPendingResult,
  type AuthUserProfile,
  type AuthUserRecord,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type ForgotUsernameInput,
  type LocalAuthenticateInput,
  type LocalSignupInput,
  type RefreshInput,
  type ResetPasswordInput,
  type ResendForgotPasswordInput,
  type ResendUnlockLocalLoginInput,
  type ResendVerificationEmailInput,
  type SetPasswordInput,
  type UsernameAvailabilityResult,
  type VerifyEmailInput,
  type UnlockLocalLoginInput,
  isStrongPassword,
} from "@/features/auth/auth.model";
import { AuthSessionService } from "@/features/auth/session/session.service";
import {
  PendingSignupStore,
  type PendingLocalSignupRecord,
} from "@/features/auth/pending-signup/pending-signup.store";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";
import {
  isEligibleForLocalPasswordManagement,
  isLocalPasswordAccount,
  requireEligibleLocalPasswordUser,
  requirePasswordlessLinkedUser,
  type LocalPasswordAuthUserRecord,
} from "@/features/auth/local-account-eligibility";
import {
  hashPassword,
  isBcryptHash,
  rejectIfPasswordMatchesCurrent,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
  verifyPasswordAgainstFakeHash,
} from "@/features/auth/password-hashing";
import { toAuthUserProfile } from "@/features/auth/user-profile-mapper";
import { requireExistingUser } from "@/features/auth/require-existing-user";
import { redactEmail } from "@/features/auth/redact-email";
import { requireLoginMfa } from "@/features/auth/mfa/login-mfa.guard";
import {
  EMAIL_VERIFICATION_OTP_PURPOSE,
  LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
  LOCAL_PASSWORD_RESET_OTP_PURPOSE,
  USERNAME_REMINDER_RATE_LIMIT_PURPOSE,
} from "@/features/auth/otp/otp-purposes";
import type { UsernameBloomService } from "@/features/auth/username-bloom/username-bloom.service";
import { OtpService } from "@/features/auth/otp/otp.service";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { TokenService } from "@/features/auth/token/token.service";
import type { AuthPrincipal } from "@/features/auth/auth.principal";
import { loggerFactory, type Logger } from "@/configuration/logging";

const MAX_FAILED_LOCAL_LOGIN_ATTEMPTS = 5;
const LOCAL_LOGIN_ATTEMPT_TTL_IN_SECONDS = 15 * 60;
const LOCAL_LOGIN_LOCK_TTL_IN_SECONDS = 30 * 60;

interface LocalLoginAttemptRecord {
  failedAttempts: number;
  lockedAt?: string;
}

export class AuthService {
  private readonly logger: Logger;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly tokenService: TokenService,
    private readonly otpService: OtpService,
    private readonly deviceService: DeviceService,
    private readonly emailService: EmailService,
    private readonly cacheService: CacheService,
    private readonly mfaTotpService: MfaTotpService,
    private readonly usernameBloomService: UsernameBloomService,
    private readonly authSessionService: AuthSessionService,
    private readonly pendingSignupStore: PendingSignupStore,
    private readonly publicOtpService: PublicOtpService,
  ) {
    this.logger = loggerFactory.forClass(AuthService, "service");
  }

  async localAuthenticate(
    input: LocalAuthenticateInput,
  ): Promise<AuthSessionResult> {
    const user = await this.authRepository.findUserByUsername(input.username);
    const isPasswordValid = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    const loginAttemptRecord = await this.getLocalLoginAttemptRecord(
      input.username,
    );

    if (loginAttemptRecord?.lockedAt && (!user || !isPasswordValid)) {
      await this.publicOtpService.sendLoginUnlockCode(user);
      throw new LockedError(
        "This sign-in is locked. Use the code we emailed you to unlock it.",
        this.buildLockedLoginDetails(user),
      );
    }

    if (!user || !isPasswordValid) {
      const updatedAttemptRecord = await this.recordFailedLocalLoginAttempt(
        input.username,
      );

      if (updatedAttemptRecord.lockedAt) {
        await this.publicOtpService.sendLoginUnlockCode(user);
        throw new LockedError(
          "This sign-in is locked. Use the code we emailed you to unlock it.",
          this.buildLockedLoginDetails(user),
        );
      }

      throw new UnauthorizedError("Invalid username or password.");
    }

    await this.clearLocalLoginAttemptRecord(input.username);

    if (!user.emailVerified) {
      throw new UnauthorizedError(
        "Please verify your email address before signing in.",
      );
    }

    await requireLoginMfa(this.mfaTotpService, user.id, user.email, input.totpCode);

    return this.authSessionService.authenticateVerifiedUser(user, input);
  }

  async localSignup(
    input: LocalSignupInput,
  ): Promise<SignupVerificationPendingResult> {
    const existingUser = await this.authRepository.findUserByEmail(input.email);
    await this.assertUsernameIsAvailable(
      input.username,
      existingUser?.id,
      input.email,
    );

    if (existingUser?.emailVerified) {
      return {
        verificationRequired: true,
        email: input.email,
        alreadyPending: false,
      };
    }

    const passwordHash = await hashPassword(input.password);
    await this.pendingSignupStore.write(
      {
        username: input.username,
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        deviceId: input.deviceId,
        createdAt: new Date().toISOString(),
      },
      this.otpService.getTtlInSeconds(),
    );
    await this.publicOtpService.sendEmailVerificationCode({
      email: input.email,
      firstName: input.firstName,
    });

    return {
      verificationRequired: true,
      email: input.email,
      alreadyPending: false,
    };
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<{
    accepted: true;
  }> {
    const rateLimitResult = await this.publicOtpService.consumeRateLimit({
      purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
      subject: input.username,
      client: input.client,
      deviceId: input.deviceId,
      flow: "forgot-password",
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

  async resendForgotPassword(input: ResendForgotPasswordInput): Promise<{
    accepted: true;
  }> {
    const rateLimitResult = await this.publicOtpService.consumeRateLimit({
      purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
      subject: input.username,
      client: input.client,
      deviceId: input.deviceId,
      flow: "resend-forgot-password",
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

    const user = await this.authRepository.findUserByEmail(input.email);

    if (user) {
      await this.publicOtpService.sendUsernameReminder(user);
    }

    return {
      accepted: true,
    };
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
    await this.authRepository.updatePasswordHash(eligibleUser.id, passwordHash);
    const nextTokenVersion = await this.authRepository.rotateTokenVersion(
      eligibleUser.id,
    );
    await this.clearLocalLoginAttemptRecord(eligibleUser.profile.username);

    const updatedUser: AuthUserRecord = {
      ...eligibleUser,
      passwordHash,
      tokenVersion: nextTokenVersion,
    };
    return this.authSessionService.reissueSessionForUser(
      updatedUser,
      input.client,
      input.deviceId,
    );
  }

  async verifyEmail(input: VerifyEmailInput): Promise<AuthSessionResult> {
    await this.otpService.verify({
      purpose: EMAIL_VERIFICATION_OTP_PURPOSE,
      subject: input.email,
      code: input.code,
    });
    const verificationLock =
      await this.pendingSignupStore.acquireVerificationLock(input.email);

    if (!verificationLock) {
      throw new BadRequestError("Verification code is invalid or has expired.");
    }

    try {
      const pendingSignup = await this.pendingSignupStore.read(input.email);

      if (!pendingSignup) {
        throw new BadRequestError(
          "Verification code is invalid or has expired.",
        );
      }

      const existingUser = await this.authRepository.findUserByEmail(
        input.email,
      );
      let verifiedUser: AuthUserRecord;

      await this.assertUsernameIsAvailable(
        pendingSignup.username,
        existingUser?.id,
        pendingSignup.email,
      );

      if (!existingUser) {
        const createdUser = await this.authRepository.createLocalUser(
          {
            username: pendingSignup.username,
            email: pendingSignup.email,
            firstName: pendingSignup.firstName,
            lastName: pendingSignup.lastName,
          },
          pendingSignup.passwordHash,
        );
        await this.authRepository.markEmailVerified(createdUser.id);
        verifiedUser = {
          ...createdUser,
          emailVerified: true,
          passwordHash: pendingSignup.passwordHash,
        };
      } else if (existingUser.emailVerified) {
        await this.pendingSignupStore.delete(input.email);
        throw new BadRequestError(
          "Verification code is invalid or has expired.",
        );
      } else {
        verifiedUser = await this.authRepository.activatePendingLocalUser(
          existingUser.id,
          {
            username: pendingSignup.username,
            passwordHash: pendingSignup.passwordHash,
            firstName: pendingSignup.firstName,
            lastName: pendingSignup.lastName,
          },
        );
      }

      await this.pendingSignupStore.delete(input.email);

      // The name was already recorded when it was reserved. Recording it again
      // as it becomes a durable row covers the case where that earlier write
      // did not reach Redis, since the reservation key is now gone.
      await this.usernameBloomService.add(pendingSignup.username);

      const resolvedDeviceId = input.deviceId ?? pendingSignup.deviceId;
      return this.authSessionService.reissueSessionForUser(
        verifiedUser,
        input.client,
        resolvedDeviceId,
      );
    } finally {
      await verificationLock.release();
    }
  }

  async resendVerificationEmail(input: ResendVerificationEmailInput): Promise<{
    accepted: true;
  }> {
    const rateLimitResult = await this.publicOtpService.consumeRateLimit({
      purpose: EMAIL_VERIFICATION_OTP_PURPOSE,
      subject: input.email,
      client: input.client,
      deviceId: input.deviceId,
      flow: "resend-verification-email",
    });

    if (!rateLimitResult.allowed) {
      this.publicOtpService.logSuspicious(rateLimitResult);
      return {
        accepted: true,
      };
    }

    const pendingSignup = await this.pendingSignupStore.read(input.email);

    if (pendingSignup) {
      await this.publicOtpService.sendPublicEmailVerificationCode({
        email: pendingSignup.email,
        firstName: pendingSignup.firstName,
      });
      return {
        accepted: true,
      };
    }

    const user = await this.authRepository.findUserByEmail(input.email);

    if (user && !user.emailVerified) {
      await this.publicOtpService.sendPublicEmailVerificationCode({
        email: user.email,
        firstName: user.firstName,
      });
    }

    return {
      accepted: true,
    };
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

    await rejectIfPasswordMatchesCurrent(
      input.newPassword,
      user.passwordHash,
    );

    const passwordHash = await hashPassword(input.newPassword);
    await this.authRepository.updatePasswordHash(user.id, passwordHash);
    const nextTokenVersion = await this.authRepository.rotateTokenVersion(
      user.id,
    );
    await this.clearLocalLoginAttemptRecord(user.profile.username);

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

    const nextTokenVersion = await this.authRepository.rotateTokenVersion(
      user.id,
    );
    await this.clearLocalLoginAttemptRecord(user.profile.username);

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

  async unlockLocalLogin(input: UnlockLocalLoginInput): Promise<{
    unlocked: true;
    email: string;
  }> {
    await this.otpService.verify({
      purpose: LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
      subject: input.email,
      code: input.code,
    });

    const user = await this.authRepository.findUserByEmail(input.email);

    if (user) {
      await this.clearLocalLoginAttemptRecord(user.profile.username);
    }

    return {
      unlocked: true,
      email: input.email,
    };
  }

  async resendUnlockLocalLogin(input: ResendUnlockLocalLoginInput): Promise<{
    accepted: true;
  }> {
    const rateLimitResult = await this.publicOtpService.consumeRateLimit({
      purpose: LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
      subject: input.email,
      client: input.client,
      deviceId: input.deviceId,
      flow: "resend-unlock-local-login",
    });

    if (!rateLimitResult.allowed) {
      this.publicOtpService.logSuspicious(rateLimitResult);
      return {
        accepted: true,
      };
    }

    const user = await this.authRepository.findUserByEmail(input.email);
    const isLocked = user
      ? await this.isLocalLoginLocked(user.profile.username)
      : false;

    if (!isLocked) {
      return {
        accepted: true,
      };
    }

    await this.publicOtpService.sendLoginUnlockCode(user);

    return {
      accepted: true,
    };
  }

  async localVerify(context: AuthRequestContext): Promise<{
    verified: true;
    auth: {
      userId: string;
      deviceId?: string;
      role?: string;
    };
    client: ClientRequestContext;
  }> {
    return {
      verified: true,
      auth: {
        userId: context.auth.sub,
        deviceId: context.auth.deviceId,
        role: context.auth.role,
      },
      client: context.client,
    };
  }

  async refresh(input: RefreshInput): Promise<AuthSessionResult> {
    if (!input.refreshToken) {
      throw new UnauthorizedError("Refresh token is required.");
    }

    const claims = await this.tokenService.verifyRefreshToken(
      input.refreshToken,
    );
    const user = await requireExistingUser(this.authRepository, claims.sub);
    const deviceId = claims.deviceId ?? input.client.device.id;
    const deviceStatus = await this.deviceService.evaluateExistingSessionDevice(
      user,
      input.client,
      deviceId,
    );
    const sessionId = claims.sessionId ?? randomUUID();
    const refreshTokenExpiresInSeconds =
      this.tokenService.getRefreshTokenExpiresInSeconds(
        Boolean(claims.rememberMe),
      );

    if (!claims.sessionId) {
      await this.tokenService.createSession(
        {
          sessionId,
          userId: user.id,
          deviceId,
          tokenVersion: user.tokenVersion,
        },
        refreshTokenExpiresInSeconds,
      );
      await this.tokenService.revokeRefreshToken(input.refreshToken);
    }

    const accessToken = this.tokenService.createAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      deviceId,
      sessionId,
      tokenVersion: user.tokenVersion,
    });
    const refreshToken = claims.sessionId
      ? await this.tokenService.rotateRefreshToken(
          input.refreshToken,
          {
            sub: user.id,
            deviceId,
            rememberMe: Boolean(claims.rememberMe),
            sessionId,
            tokenVersion: user.tokenVersion,
          },
          {
            expiresInSeconds: refreshTokenExpiresInSeconds,
          },
        )
      : await this.tokenService.createRefreshToken(
          {
            sub: user.id,
            deviceId,
            rememberMe: Boolean(claims.rememberMe),
            sessionId,
            tokenVersion: user.tokenVersion,
          },
          {
            expiresInSeconds: refreshTokenExpiresInSeconds,
          },
        );

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresInSeconds,
      device: deviceStatus,
      user: toAuthUserProfile(user),
    };
  }

  async logout(context: AuthRequestContext): Promise<{
    loggedOut: true;
    auth: {
      userId: string;
      deviceId?: string;
    };
    client: ClientRequestContext;
  }> {
    if (context.refreshToken) {
      try {
        await this.tokenService.revokeRefreshToken(context.refreshToken);
      } catch {
        // Logout should still invalidate the current server-side session.
      }
    }

    if (context.auth.authMethod === "jwt" && context.auth.sessionId) {
      await this.tokenService.revokeSession(context.auth.sessionId);
    } else {
      await this.authRepository.rotateTokenVersion(context.auth.sub);
    }

    return {
      loggedOut: true,
      auth: {
        userId: context.auth.sub,
        deviceId: context.auth.deviceId,
      },
      client: context.client,
    };
  }

  private resolvePasswordResetOtpSubject(
    user: AuthUserRecord | null,
    username: string,
  ): string {
    return user?.email ?? `auth:missing-password-reset:${username}`;
  }

  private getLocalLoginAttemptKey(username: string): string {
    return `auth:local-login-attempts:${username.toLowerCase()}`;
  }

  private async getLocalLoginAttemptRecord(
    username: string,
  ): Promise<LocalLoginAttemptRecord | null> {
    return this.cacheService.getJson<LocalLoginAttemptRecord>(
      this.getLocalLoginAttemptKey(username),
    );
  }

  private async recordFailedLocalLoginAttempt(
    username: string,
  ): Promise<LocalLoginAttemptRecord> {
    const existingRecord = await this.getLocalLoginAttemptRecord(username);
    const nextFailedAttempts = (existingRecord?.failedAttempts ?? 0) + 1;
    const nextRecord: LocalLoginAttemptRecord =
      nextFailedAttempts >= MAX_FAILED_LOCAL_LOGIN_ATTEMPTS
        ? {
            failedAttempts: nextFailedAttempts,
            lockedAt: new Date().toISOString(),
          }
        : {
            failedAttempts: nextFailedAttempts,
          };

    await this.cacheService.setJson(
      this.getLocalLoginAttemptKey(username),
      nextRecord,
      nextRecord.lockedAt
        ? LOCAL_LOGIN_LOCK_TTL_IN_SECONDS
        : LOCAL_LOGIN_ATTEMPT_TTL_IN_SECONDS,
    );

    return nextRecord;
  }

  private async clearLocalLoginAttemptRecord(username: string): Promise<void> {
    await this.cacheService.delete(this.getLocalLoginAttemptKey(username));
  }

  private async isLocalLoginLocked(username: string): Promise<boolean> {
    const record = await this.getLocalLoginAttemptRecord(username);
    return Boolean(record?.lockedAt);
  }

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
      await this.authRepository.findUserIdByUsername(normalizedUsername);

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

  private async assertUsernameIsAvailable(
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

  private buildLockedLoginDetails(user: AuthUserRecord | null) {
    return {
      ...(user ? { email: user.email } : {}),
      unlockRequired: true,
    };
  }
}
