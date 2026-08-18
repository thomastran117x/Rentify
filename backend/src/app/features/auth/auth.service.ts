import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
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
  type AuthSessionResult,
  type SignupVerificationPendingResult,
  type AuthUserProfile,
  type AuthUserRecord,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type ForgotUsernameInput,
  type LinkedOAuthProvidersResult,
  type LinkOAuthProviderInput,
  type LocalAuthenticateInput,
  type LocalSignupInput,
  type OAuthAuthenticateInput,
  type OAuthProvider,
  type RefreshInput,
  type ResetPasswordInput,
  type RemoveKnownDeviceInput,
  type ResendForgotPasswordInput,
  type ResendUnlockLocalLoginInput,
  type ResendVerificationEmailInput,
  type SetPasswordInput,
  type UnlinkOAuthProviderInput,
  type UsernameAvailabilityResult,
  type VerifyEmailInput,
  type UnlockLocalLoginInput,
  isStrongPassword,
} from "@/features/auth/auth.model";
import { getPendingSignupUsernameKey } from "@/features/auth/pending-signup-username";
import type { UsernameBloomService } from "@/features/auth/username-bloom/username-bloom.service";
import { OtpService } from "@/features/auth/otp/otp.service";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { isMfaBypassEligible } from "@/features/auth/mfa/mfa-bypass";
import { AppleOAuthService } from "@/features/auth/oauth/apple.service";
import { GoogleOAuthService } from "@/features/auth/oauth/google.service";
import { MicrosoftOAuthService } from "@/features/auth/oauth/microsoft.service";
import type { VerifiedOAuthProfile } from "@/features/auth/oauth/oauth.types";
import { TokenService } from "@/features/auth/token/token.service";
import type { AuthPrincipal } from "@/features/auth/auth.principal";
import { loggerFactory, type Logger } from "@/configuration/logging";

interface AuthRequestContext {
  auth: AuthPrincipal;
  client: ClientRequestContext;
  refreshToken?: string;
}

interface PendingLocalSignupRecord {
  username: string;
  email: string;
  passwordHash: string;
  firstName?: string;
  lastName?: string;
  deviceId?: string;
  createdAt: string;
}

interface VerificationRecipient {
  email: string;
  firstName?: string;
}

const BCRYPT_SALT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH =
  "$2b$12$1M7NQyWNh5v3NFg4cTQdUeVUI5BvR9f0vAOVeI3E1FQfQ0rFJz0Vy";
const MAX_FAILED_LOCAL_LOGIN_ATTEMPTS = 5;
const LOCAL_LOGIN_ATTEMPT_TTL_IN_SECONDS = 15 * 60;
const LOCAL_LOGIN_LOCK_TTL_IN_SECONDS = 30 * 60;
const LOCAL_LOGIN_UNLOCK_OTP_PURPOSE = "local-login-unlock";
const LOCAL_PASSWORD_RESET_OTP_PURPOSE = "local-password-reset";
const USERNAME_REMINDER_RATE_LIMIT_PURPOSE = "username-reminder";
const EMAIL_VERIFICATION_OTP_PURPOSE = "email-verification";
const PENDING_LOCAL_SIGNUP_CACHE_PREFIX = "auth:pending-signup";
const PENDING_LOCAL_SIGNUP_VERIFY_LOCK_PREFIX = "auth:pending-signup-verify";
const PENDING_LOCAL_SIGNUP_VERIFY_LOCK_TTL_IN_MS = 10_000;
const PUBLIC_OTP_RATE_LIMIT_WINDOW_IN_SECONDS = 60 * 60;
const PUBLIC_OTP_EMAIL_LIMIT = 5;
const PUBLIC_OTP_IP_LIMIT = 20;
const PUBLIC_OTP_DEVICE_LIMIT = 10;

interface LocalLoginAttemptRecord {
  failedAttempts: number;
  lockedAt?: string;
}

interface PublicOtpRateLimitRecord {
  count: number;
}

type PublicOtpRateLimitResult = {
  allowed: boolean;
  flow: string;
  purpose: string;
  subject: string;
  reason?: string;
  scope?: "email" | "ip" | "device";
};

type LocalPasswordAuthUserRecord = AuthUserRecord & {
  passwordHash: string;
};

export class AuthService {
  private readonly logger: Logger;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly tokenService: TokenService,
    private readonly otpService: OtpService,
    private readonly deviceService: DeviceService,
    private readonly emailService: EmailService,
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly microsoftOAuthService: MicrosoftOAuthService,
    private readonly appleOAuthService: AppleOAuthService,
    private readonly cacheService: CacheService,
    private readonly mfaTotpService: MfaTotpService,
    private readonly usernameBloomService: UsernameBloomService,
  ) {
    this.logger = loggerFactory.forClass(AuthService, "service");
  }

  async localAuthenticate(
    input: LocalAuthenticateInput,
  ): Promise<AuthSessionResult> {
    const user = await this.authRepository.findUserByUsername(input.username);
    const isPasswordValid = await this.verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    const loginAttemptRecord = await this.getLocalLoginAttemptRecord(
      input.username,
    );

    if (loginAttemptRecord?.lockedAt && (!user || !isPasswordValid)) {
      await this.sendLocalLoginUnlockCode(user);
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
        await this.sendLocalLoginUnlockCode(user);
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

    await this.requireMfaIfEnabled(user.id, user.email, input.totpCode);

    return this.authenticateVerifiedUser(user, input);
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

    const passwordHash = await this.hashPassword(input.password);
    await this.writePendingLocalSignup(
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
    await this.sendVerificationCode({
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
    const rateLimitResult = await this.consumePublicOtpRateLimit({
      purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
      subject: input.username,
      client: input.client,
      deviceId: input.deviceId,
      flow: "forgot-password",
    });

    if (!rateLimitResult.allowed) {
      this.logSuspiciousOtpPattern(rateLimitResult);
      return {
        accepted: true,
      };
    }

    const user = await this.authRepository.findUserByUsername(input.username);

    if (user && this.isEligibleForLocalPasswordManagement(user)) {
      await this.sendPasswordResetCode(user);
    }

    return {
      accepted: true,
    };
  }

  async resendForgotPassword(input: ResendForgotPasswordInput): Promise<{
    accepted: true;
  }> {
    const rateLimitResult = await this.consumePublicOtpRateLimit({
      purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
      subject: input.username,
      client: input.client,
      deviceId: input.deviceId,
      flow: "resend-forgot-password",
    });

    if (!rateLimitResult.allowed) {
      this.logSuspiciousOtpPattern(rateLimitResult);
      return {
        accepted: true,
      };
    }

    const user = await this.authRepository.findUserByUsername(input.username);

    if (user && this.isEligibleForLocalPasswordManagement(user)) {
      await this.sendPasswordResetCode(user);
    }

    return {
      accepted: true,
    };
  }

  async forgotUsername(input: ForgotUsernameInput): Promise<{
    accepted: true;
  }> {
    const rateLimitResult = await this.consumePublicOtpRateLimit({
      purpose: USERNAME_REMINDER_RATE_LIMIT_PURPOSE,
      subject: input.email,
      client: input.client,
      deviceId: input.deviceId,
      flow: "forgot-username",
    });

    if (!rateLimitResult.allowed) {
      this.logSuspiciousOtpPattern(rateLimitResult);
      return {
        accepted: true,
      };
    }

    const user = await this.authRepository.findUserByEmail(input.email);

    if (user) {
      await this.sendUsernameReminder(user);
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

    const eligibleUser = this.requireEligibleLocalPasswordUser(
      user,
      "This account cannot reset a password.",
    );
    const passwordHash = await this.hashPassword(input.newPassword);

    await this.rejectIfPasswordMatchesCurrent(
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
    const deviceStatus = await this.deviceService.evaluateExistingSessionDevice(
      updatedUser,
      input.client,
      input.deviceId,
    );

    return this.issueTokensForUser(updatedUser, deviceStatus, input.deviceId);
  }

  async verifyEmail(input: VerifyEmailInput): Promise<AuthSessionResult> {
    await this.otpService.verify({
      purpose: EMAIL_VERIFICATION_OTP_PURPOSE,
      subject: input.email,
      code: input.code,
    });
    const verificationLock =
      await this.acquirePendingLocalSignupVerificationLock(input.email);

    if (!verificationLock) {
      throw new BadRequestError("Verification code is invalid or has expired.");
    }

    try {
      const pendingSignup = await this.readPendingLocalSignup(input.email);

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
        await this.deletePendingLocalSignup(input.email);
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

      await this.deletePendingLocalSignup(input.email);

      // The name was already recorded when it was reserved. Recording it again
      // as it becomes a durable row covers the case where that earlier write
      // did not reach Redis, since the reservation key is now gone.
      await this.usernameBloomService.add(pendingSignup.username);

      const resolvedDeviceId = input.deviceId ?? pendingSignup.deviceId;
      const deviceStatus =
        await this.deviceService.evaluateExistingSessionDevice(
          verifiedUser,
          input.client,
          resolvedDeviceId,
        );

      return this.issueTokensForUser(
        verifiedUser,
        deviceStatus,
        resolvedDeviceId,
      );
    } finally {
      await verificationLock.release();
    }
  }

  async resendVerificationEmail(input: ResendVerificationEmailInput): Promise<{
    accepted: true;
  }> {
    const rateLimitResult = await this.consumePublicOtpRateLimit({
      purpose: EMAIL_VERIFICATION_OTP_PURPOSE,
      subject: input.email,
      client: input.client,
      deviceId: input.deviceId,
      flow: "resend-verification-email",
    });

    if (!rateLimitResult.allowed) {
      this.logSuspiciousOtpPattern(rateLimitResult);
      return {
        accepted: true,
      };
    }

    const pendingSignup = await this.readPendingLocalSignup(input.email);

    if (pendingSignup) {
      await this.sendPublicVerificationCode({
        email: pendingSignup.email,
        firstName: pendingSignup.firstName,
      });
      return {
        accepted: true,
      };
    }

    const user = await this.authRepository.findUserByEmail(input.email);

    if (user && !user.emailVerified) {
      await this.sendPublicVerificationCode({
        email: user.email,
        firstName: user.firstName,
      });
    }

    return {
      accepted: true,
    };
  }

  async changePassword(input: ChangePasswordInput): Promise<AuthSessionResult> {
    const user = this.requireEligibleLocalPasswordUser(
      await this.authRepository.findUserById(input.userId),
      "This account cannot change a password.",
    );
    const isPasswordValid = await this.verifyPassword(
      input.currentPassword,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedError("Current password is incorrect.");
    }

    await this.rejectIfPasswordMatchesCurrent(
      input.newPassword,
      user.passwordHash,
    );

    const passwordHash = await this.hashPassword(input.newPassword);
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
    const deviceStatus = await this.deviceService.evaluateExistingSessionDevice(
      updatedUser,
      input.client,
      input.deviceId,
    );

    return this.issueTokensForUser(updatedUser, deviceStatus, input.deviceId);
  }

  /**
   * Adds local password sign-in to an account that only has social providers.
   * There is no current password to re-enter, so the caller must have already
   * satisfied the `mfa-management` step-up guard.
   */
  async setPassword(input: SetPasswordInput): Promise<AuthSessionResult> {
    const user = this.requirePasswordlessLinkedUser(
      await this.authRepository.findUserById(input.userId),
    );

    const passwordHash = await this.hashPassword(input.newPassword);
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
    const deviceStatus = await this.deviceService.evaluateExistingSessionDevice(
      updatedUser,
      input.client,
      input.deviceId,
    );

    return this.issueTokensForUser(updatedUser, deviceStatus, input.deviceId);
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
    const rateLimitResult = await this.consumePublicOtpRateLimit({
      purpose: LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
      subject: input.email,
      client: input.client,
      deviceId: input.deviceId,
      flow: "resend-unlock-local-login",
    });

    if (!rateLimitResult.allowed) {
      this.logSuspiciousOtpPattern(rateLimitResult);
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

    await this.sendLocalLoginUnlockCode(user);

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

  async googleAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult> {
    const profile = await this.googleOAuthService.verify(input);
    return this.authenticateOAuthProfile(profile, input);
  }

  async microsoftAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult> {
    const profile = await this.microsoftOAuthService.verify(input);
    return this.authenticateOAuthProfile(profile, input);
  }

  async appleAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult> {
    const profile = await this.appleOAuthService.verify(input);
    return this.authenticateOAuthProfile(profile, input);
  }

  async linkOAuthProvider(
    input: LinkOAuthProviderInput,
  ): Promise<LinkedOAuthProvidersResult> {
    const user = await this.requireExistingUser(input.userId);
    const profile = await this.verifyOAuthInput(input.provider, input);

    this.requireVerifiedOAuthProfile(profile);

    const existingProviderUser =
      await this.authRepository.findUserByOAuthIdentity(
        profile.provider,
        profile.providerUserId,
      );

    if (existingProviderUser && existingProviderUser.id !== user.id) {
      throw new ConflictError(
        "This OAuth provider is already linked to another account.",
      );
    }

    if (
      existingProviderUser?.id === user.id ||
      user.oauthIdentities.some(
        (identity) => identity.provider === profile.provider,
      )
    ) {
      return this.listLinkedOAuthProvidersForUser(user);
    }

    await this.authRepository.linkOAuthIdentity(user.id, profile);
    return this.linkedOAuthProviders({
      ...user,
      oauthIdentities: await this.authRepository.listOAuthIdentitiesByUserId(
        user.id,
      ),
    });
  }

  async linkedOAuthProviders(context: {
    userId: string;
  }): Promise<LinkedOAuthProvidersResult>;
  async linkedOAuthProviders(
    user: AuthUserRecord,
  ): Promise<LinkedOAuthProvidersResult>;
  async linkedOAuthProviders(
    input: { userId: string } | AuthUserRecord,
  ): Promise<LinkedOAuthProvidersResult> {
    const user =
      "email" in input ? input : await this.requireExistingUser(input.userId);
    return this.listLinkedOAuthProvidersForUser(user);
  }

  async unlinkOAuthProvider(
    input: UnlinkOAuthProviderInput,
  ): Promise<LinkedOAuthProvidersResult> {
    const user = await this.requireExistingUser(input.userId);

    if (
      !user.oauthIdentities.some(
        (identity) => identity.provider === input.provider,
      )
    ) {
      return this.listLinkedOAuthProvidersForUser(user);
    }

    if (
      !this.isLocalPasswordAccount(user) &&
      user.oauthIdentities.length <= 1
    ) {
      throw new ConflictError(
        "Add another sign-in method before unlinking this provider.",
      );
    }

    await this.authRepository.unlinkOAuthIdentity(user.id, input.provider);
    return this.linkedOAuthProviders({
      ...user,
      oauthIdentities: await this.authRepository.listOAuthIdentitiesByUserId(
        user.id,
      ),
    });
  }

  async refresh(input: RefreshInput): Promise<AuthSessionResult> {
    if (!input.refreshToken) {
      throw new UnauthorizedError("Refresh token is required.");
    }

    const claims = await this.tokenService.verifyRefreshToken(
      input.refreshToken,
    );
    const user = await this.requireExistingUser(claims.sub);
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
      user: this.toUserProfile(user),
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

  async deviceVerify(context: AuthRequestContext): Promise<{
    verified: true;
    device: ClientRequestContext["device"] & {
      known: boolean;
      knownByIp: boolean;
      deviceId?: string;
    };
    auth: {
      userId: string;
      tokenDeviceId?: string;
    };
  }> {
    const user = await this.requireExistingUser(context.auth.sub);
    const deviceStatus = await this.deviceService.registerKnownDevice(
      user,
      context.client,
      context.auth.deviceId ?? context.client.device.id,
    );

    return {
      verified: true,
      device: {
        ...context.client.device,
        known: deviceStatus.known,
        knownByIp: deviceStatus.knownByIp,
        deviceId: deviceStatus.deviceId,
      },
      auth: {
        userId: context.auth.sub,
        tokenDeviceId: context.auth.deviceId,
      },
    };
  }

  async devices(context: AuthRequestContext): Promise<{
    devices: Array<{
      id: string;
      current: boolean;
      deviceId: string;
      type: string;
      platform?: string;
      userAgent?: string;
      lastIpAddress?: string;
      firstSeenAt: string;
      lastSeenAt: string;
      verifiedAt: string;
    }>;
  }> {
    const knownDevices = await this.deviceService.listKnownDevices(
      context.auth.sub,
      context.auth.deviceId,
    );

    return {
      devices: knownDevices.map((device) => ({
        id: device.id,
        current: device.current,
        deviceId: device.deviceId,
        type: device.type,
        platform: device.platform,
        userAgent: device.userAgent,
        lastIpAddress: device.lastIpAddress,
        firstSeenAt: device.firstSeenAt,
        lastSeenAt: device.lastSeenAt,
        verifiedAt: device.verifiedAt,
      })),
    };
  }

  async removeKnownDevice(input: RemoveKnownDeviceInput): Promise<{
    removed: true;
    deviceId: string;
  }> {
    await this.deviceService.removeKnownDevice(input.userId, input.deviceId);
    await this.tokenService.revokeSessionsForDevice(
      input.userId,
      input.deviceId,
    );

    return {
      removed: true,
      deviceId: input.deviceId,
    };
  }

  private async issueTokensForUser(
    user: AuthUserRecord,
    deviceStatus: { deviceId?: string; known: boolean; knownByIp: boolean },
    deviceId?: string,
    rememberMe = false,
  ): Promise<AuthSessionResult> {
    const sessionId = randomUUID();
    const accessToken = this.tokenService.createAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      deviceId,
      sessionId,
      tokenVersion: user.tokenVersion,
    });

    const refreshTokenExpiresInSeconds =
      this.tokenService.getRefreshTokenExpiresInSeconds(rememberMe);
    await this.tokenService.createSession(
      {
        sessionId,
        userId: user.id,
        deviceId,
        tokenVersion: user.tokenVersion,
      },
      refreshTokenExpiresInSeconds,
    );
    const refreshToken = await this.tokenService.createRefreshToken(
      {
        sub: user.id,
        deviceId,
        rememberMe,
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
      user: this.toUserProfile(user),
    };
  }

  private async authenticateOAuthProfile(
    profile: VerifiedOAuthProfile,
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult> {
    this.requireVerifiedOAuthProfile(profile);

    const linkedUser = await this.authRepository.findUserByOAuthIdentity(
      profile.provider,
      profile.providerUserId,
    );

    if (linkedUser) {
      await this.requireMfaIfEnabled(
        linkedUser.id,
        linkedUser.email,
        input.totpCode,
      );
      return this.authenticateVerifiedUser(linkedUser, input);
    }

    if (await this.authRepository.findUserByEmail(profile.email)) {
      throw new ConflictError(
        "An account with this email already exists. Sign in with the original method before linking a social provider.",
      );
    }

    const user = await this.authRepository.createOAuthUser(
      profile,
      (candidate) =>
        this.usernameBloomService.check(candidate) === "possibly-present",
    );
    await this.usernameBloomService.add(user.profile.username);
    const session = await this.authenticateVerifiedUser(user, input);
    return { ...session, isNewUser: true };
  }

  private async verifyOAuthInput(
    provider: OAuthProvider,
    input: OAuthAuthenticateInput,
  ): Promise<VerifiedOAuthProfile> {
    if (provider === "google") {
      return this.googleOAuthService.verify(input);
    }

    if (provider === "microsoft") {
      return this.microsoftOAuthService.verify(input);
    }

    return this.appleOAuthService.verify(input);
  }

  private requireVerifiedOAuthProfile(profile: VerifiedOAuthProfile): void {
    if (!profile.emailVerified) {
      throw new Error("OAuth account email must be verified.");
    }
  }

  private async hashPassword(password: string): Promise<string> {
    this.assertValidPassword(password);
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  private async verifyPassword(
    password: string,
    passwordHash: string,
  ): Promise<boolean> {
    return this.isBcryptHash(passwordHash)
      ? bcrypt.compare(password, passwordHash)
      : this.verifyPasswordAgainstFakeHash(password);
  }

  private async verifyPasswordAgainstFakeHash(
    password: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, DUMMY_PASSWORD_HASH);
  }

  private async rejectIfPasswordMatchesCurrent(
    password: string,
    passwordHash: string,
  ): Promise<void> {
    const matchesCurrentPassword = await this.verifyPassword(
      password,
      passwordHash,
    );

    if (matchesCurrentPassword) {
      throw new ConflictError(
        "New password must be different from the current password.",
      );
    }
  }

  private assertValidPassword(password: string): void {
    if (!isStrongPassword(password)) {
      throw new Error(
        "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.",
      );
    }
  }

  private isBcryptHash(passwordHash: string): boolean {
    return /^\$2[aby]\$\d{2}\$/.test(passwordHash);
  }

  private toUserProfile(user: AuthUserRecord): AuthUserProfile {
    const activeOrganization = this.resolveActiveOrganization(user);
    const organizationMemberships = this.readOrganizationMemberships(user);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.profile.username,
      phoneNumber: user.profile.phoneNumber,
      avatarUrl: user.profile.avatarUrl,
      isPrivate: user.profile.isPrivate,
      recommendationPersonalizationEnabled:
        user.profile.recommendationPersonalizationEnabled,
      trustworthinessScore: user.profile.trustworthinessScore,
      rentPostingsCount: user.profile.rentPostingsCount,
      availableRentPostingsCount: user.profile.availableRentPostingsCount,
      role: user.role,
      emailVerified: user.emailVerified,
      activeOrganization,
      organizationMembershipCount: organizationMemberships.length,
    };
  }

  private async sendVerificationCode(
    recipient: VerificationRecipient,
  ): Promise<void> {
    const issuedOtp = await this.otpService.issue({
      purpose: EMAIL_VERIFICATION_OTP_PURPOSE,
      subject: recipient.email,
    });

    await this.emailService.sendVerificationEmail({
      to: recipient.email,
      verificationCode: issuedOtp.code,
      firstName: recipient.firstName,
      expiresInMinutes: Math.round(issuedOtp.ttlInSeconds / 60),
    });
  }

  private async sendPublicVerificationCode(
    recipient: VerificationRecipient,
  ): Promise<void> {
    try {
      await this.sendVerificationCode(recipient);
    } catch (error) {
      if (error instanceof Error && error.name === "TooManyRequestError") {
        this.logSuspiciousOtpPattern({
          allowed: false,
          flow: "resend-verification-email",
          purpose: EMAIL_VERIFICATION_OTP_PURPOSE,
          subject: recipient.email,
          reason: "otp-cooldown",
        });
        return;
      }

      throw error;
    }
  }

  private resolvePasswordResetOtpSubject(
    user: AuthUserRecord | null,
    username: string,
  ): string {
    return user?.email ?? `auth:missing-password-reset:${username}`;
  }

  private async sendPasswordResetCode(user: AuthUserRecord): Promise<void> {
    try {
      const issuedOtp = await this.otpService.issue({
        purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
        subject: user.email,
      });

      await this.emailService.sendPasswordResetEmail({
        to: user.email,
        resetCode: issuedOtp.code,
        firstName: user.firstName,
        expiresInMinutes: Math.round(issuedOtp.ttlInSeconds / 60),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TooManyRequestError") {
        this.logSuspiciousOtpPattern({
          allowed: false,
          flow: "password-reset",
          purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
          subject: user.email,
          reason: "otp-cooldown",
        });
        return;
      }

      throw error;
    }
  }

  private async sendUsernameReminder(user: AuthUserRecord): Promise<void> {
    await this.emailService.sendUsernameReminderEmail({
      to: user.email,
      username: user.profile.username,
      firstName: user.firstName,
    });
  }

  private async requireMfaIfEnabled(
    userId: string,
    email: string,
    totpCode: string | undefined,
  ): Promise<void> {
    if (isMfaBypassEligible(email)) {
      this.logger.info("MFA bypass used", {
        userId,
        email: this.redactEmail(email),
        result: "bypass",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const mfaEnabled = await this.mfaTotpService.isEnabled(userId);

    if (!mfaEnabled) {
      return;
    }

    if (!totpCode) {
      throw new UnauthorizedError("Authenticator code is required.", {
        mfaRequired: true,
      });
    }

    await this.mfaTotpService.verifyCode(userId, totpCode);
  }

  private async authenticateVerifiedUser(
    user: AuthUserRecord,
    input: {
      deviceId?: string;
      client: ClientRequestContext;
      rememberMe?: boolean;
    },
  ): Promise<AuthSessionResult> {
    const deviceStatus =
      await this.deviceService.evaluateSuccessfulAuthentication(
        user,
        input.client,
        input.deviceId,
      );

    return this.issueTokensForUser(
      user,
      deviceStatus,
      input.deviceId,
      Boolean(input.rememberMe),
    );
  }

  private getPendingLocalSignupKey(email: string): string {
    return `${PENDING_LOCAL_SIGNUP_CACHE_PREFIX}:${email.toLowerCase()}`;
  }

  private getPendingLocalSignupUsernameKey(username: string): string {
    return getPendingSignupUsernameKey(username);
  }

  private getPendingLocalSignupVerifyLockKey(email: string): string {
    return `${PENDING_LOCAL_SIGNUP_VERIFY_LOCK_PREFIX}:${email.toLowerCase()}`;
  }

  private async writePendingLocalSignup(
    signup: PendingLocalSignupRecord,
    ttlInSeconds: number,
  ): Promise<void> {
    const existingSignup = await this.readPendingLocalSignup(signup.email);

    if (existingSignup && existingSignup.username !== signup.username) {
      await this.cacheService.delete(
        this.getPendingLocalSignupUsernameKey(existingSignup.username),
      );
    }

    await this.cacheService.setJson(
      this.getPendingLocalSignupKey(signup.email),
      signup,
      ttlInSeconds,
    );
    await this.cacheService.setJson(
      this.getPendingLocalSignupUsernameKey(signup.username),
      signup.email,
      ttlInSeconds,
    );

    // A reservation makes the name unavailable just as surely as a row does, and
    // a bloom miss skips the reservation lookup too. Leaving it out would let
    // the endpoint report a reserved name as free.
    await this.usernameBloomService.add(signup.username);
  }

  private async readPendingLocalSignup(
    email: string,
  ): Promise<PendingLocalSignupRecord | null> {
    return this.cacheService.getJson<PendingLocalSignupRecord>(
      this.getPendingLocalSignupKey(email),
    );
  }

  private async deletePendingLocalSignup(email: string): Promise<void> {
    const pendingSignup = await this.readPendingLocalSignup(email);

    if (pendingSignup) {
      await this.cacheService.delete(
        this.getPendingLocalSignupUsernameKey(pendingSignup.username),
      );
    }

    await this.cacheService.delete(this.getPendingLocalSignupKey(email));
  }

  private acquirePendingLocalSignupVerificationLock(email: string) {
    return this.cacheService.acquireLock(
      this.getPendingLocalSignupVerifyLockKey(email),
      PENDING_LOCAL_SIGNUP_VERIFY_LOCK_TTL_IN_MS,
    );
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

  private async consumePublicOtpRateLimit(input: {
    purpose: string;
    subject: string;
    client: ClientRequestContext;
    deviceId?: string;
    flow: string;
  }): Promise<PublicOtpRateLimitResult> {
    const checks: Array<{
      scope: "email" | "ip" | "device";
      value?: string;
      limit: number;
    }> = [
      {
        scope: "email",
        value: input.subject.toLowerCase(),
        limit: PUBLIC_OTP_EMAIL_LIMIT,
      },
      {
        scope: "ip",
        value: input.client.ip,
        limit: PUBLIC_OTP_IP_LIMIT,
      },
      {
        scope: "device",
        value: input.deviceId ?? input.client.device.id,
        limit: PUBLIC_OTP_DEVICE_LIMIT,
      },
    ];
    const records: Array<{
      key: string;
      scope: "email" | "ip" | "device";
      count: number;
      limit: number;
    }> = [];

    for (const check of checks) {
      if (!check.value) {
        continue;
      }

      const key = this.getPublicOtpRateLimitKey(
        input.purpose,
        check.scope,
        check.value,
      );
      const record =
        await this.cacheService.getJson<PublicOtpRateLimitRecord>(key);
      const count = record?.count ?? 0;

      if (count >= check.limit) {
        return {
          allowed: false,
          flow: input.flow,
          purpose: input.purpose,
          subject: input.subject,
          reason: `${check.scope}-rate-limit`,
          scope: check.scope,
        };
      }

      records.push({
        key,
        scope: check.scope,
        count,
        limit: check.limit,
      });
    }

    await Promise.all(
      records.map((record) =>
        this.cacheService.setJson(
          record.key,
          {
            count: record.count + 1,
          } satisfies PublicOtpRateLimitRecord,
          PUBLIC_OTP_RATE_LIMIT_WINDOW_IN_SECONDS,
        ),
      ),
    );

    return {
      allowed: true,
      flow: input.flow,
      purpose: input.purpose,
      subject: input.subject,
    };
  }

  private getPublicOtpRateLimitKey(
    purpose: string,
    scope: "email" | "ip" | "device",
    value: string,
  ): string {
    return `auth:otp-rate:${purpose}:${scope}:${value.toLowerCase()}`;
  }

  private logSuspiciousOtpPattern(result: PublicOtpRateLimitResult): void {
    this.logger.warn("Suspicious public OTP activity", {
      flow: result.flow,
      purpose: result.purpose,
      subject: this.redactEmail(result.subject),
      reason: result.reason,
      scope: result.scope,
    });
  }

  private redactEmail(email: string): string {
    const [localPart, domain] = email.toLowerCase().split("@");

    if (!localPart || !domain) {
      return "redacted";
    }

    return `${localPart.slice(0, 1)}***@${domain}`;
  }

  private async readPendingSignupEmailByUsername(
    username: string,
  ): Promise<string | null> {
    return this.cacheService.getJson<string>(
      this.getPendingLocalSignupUsernameKey(username),
    );
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
      await this.readPendingSignupEmailByUsername(normalizedUsername);

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

  private async sendLocalLoginUnlockCode(
    user: AuthUserRecord | null,
  ): Promise<void> {
    if (!user) {
      return;
    }

    try {
      const issuedOtp = await this.otpService.issue({
        purpose: LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
        subject: user.email,
      });

      await this.emailService.sendLoginUnlockEmail({
        to: user.email,
        unlockCode: issuedOtp.code,
        firstName: user.firstName,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TooManyRequestError") {
        this.logSuspiciousOtpPattern({
          allowed: false,
          flow: "local-login-unlock",
          purpose: LOCAL_LOGIN_UNLOCK_OTP_PURPOSE,
          subject: user.email,
          reason: "otp-cooldown",
        });
        return;
      }

      throw error;
    }
  }

  private isEligibleForLocalPasswordManagement(user: AuthUserRecord): boolean {
    return user.emailVerified && this.isLocalPasswordAccount(user);
  }

  private isLocalPasswordAccount(
    user: AuthUserRecord,
  ): user is LocalPasswordAuthUserRecord {
    return Boolean(user.passwordHash && this.isBcryptHash(user.passwordHash));
  }

  private requireEligibleLocalPasswordUser(
    user: AuthUserRecord | null,
    defaultMessage: string,
  ): LocalPasswordAuthUserRecord {
    if (!user) {
      throw new BadRequestError(defaultMessage);
    }

    if (!this.isLocalPasswordAccount(user)) {
      throw new ConflictError(
        "This account uses a social sign-in provider. Use that provider to access your account.",
      );
    }

    if (!user.emailVerified) {
      throw new ConflictError(
        "Please verify your email address before managing your password.",
      );
    }

    return user;
  }

  /**
   * Inverse of {@link requireEligibleLocalPasswordUser}: accepts only accounts
   * that have no local password yet but do own a linked social identity, i.e.
   * the accounts that can add password sign-in alongside their provider.
   */
  private requirePasswordlessLinkedUser(
    user: AuthUserRecord | null,
  ): AuthUserRecord {
    if (!user) {
      throw new BadRequestError("This account cannot set a password.");
    }

    if (this.isLocalPasswordAccount(user)) {
      throw new ConflictError(
        "This account already has a password. Use the change password option instead.",
      );
    }

    if (!user.emailVerified) {
      throw new ConflictError(
        "Please verify your email address before managing your password.",
      );
    }

    if (user.oauthIdentities.length === 0) {
      throw new ConflictError("This account cannot set a password.");
    }

    return user;
  }

  private listLinkedOAuthProvidersForUser(
    user: AuthUserRecord,
  ): LinkedOAuthProvidersResult {
    return {
      hasPassword: this.isLocalPasswordAccount(user),
      providers: user.oauthIdentities.map((identity) => ({
        id: identity.id,
        provider: identity.provider,
        providerEmail: identity.providerEmail,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        linkedAt: identity.linkedAt,
      })),
    };
  }

  private async requireExistingUser(userId: string): Promise<AuthUserRecord> {
    const user = await this.authRepository.findUserById(userId);

    if (!user) {
      throw new BadRequestError("User account could not be found.");
    }

    return user;
  }

  private resolveActiveOrganization(
    user: AuthUserRecord,
  ): AuthActiveOrganizationSummary | undefined {
    const organizationMemberships = this.readOrganizationMemberships(user);
    const activeMembership =
      organizationMemberships.find(
        (membership) =>
          membership.organizationId === user.preferredOrganizationId,
      ) ?? organizationMemberships[0];

    if (!activeMembership) {
      return undefined;
    }

    return {
      id: activeMembership.organizationId,
      name: activeMembership.organizationName,
      role: activeMembership.role,
    };
  }

  private readOrganizationMemberships(user: AuthUserRecord) {
    return Array.isArray(user.organizationMemberships)
      ? user.organizationMemberships
      : [];
  }
}
