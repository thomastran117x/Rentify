import { randomUUID } from "node:crypto";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import LockedError from "@/errors/http/locked.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { DeviceService } from "@/features/auth/device/device.service";
import type { CacheService } from "@/features/cache/cache.service";
import { EmailService } from "@/features/email/email.service";
import { UsersRepository } from "@/features/auth/users/users.repository";
import {
  type AuthActiveOrganizationSummary,
  type AuthSessionResult,
  type AuthUserProfile,
  type AuthUserRecord,
  isStrongPassword,
} from "@/features/auth/auth.model";
import type {
  LocalAuthenticateInput,
  LocalSignupInput,
  ResendVerificationEmailInput,
  SignupVerificationPendingResult,
  VerifyEmailInput,
} from "@/features/auth/local/local-auth.model";
import { AuthSessionService } from "@/features/auth/session/session.service";
import {
  PendingSignupStore,
  type PendingLocalSignupRecord,
} from "@/features/auth/pending-signup/pending-signup.store";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";
import { UsernameService } from "@/features/auth/username/username.service";
import { LoginLockoutService } from "@/features/auth/lockout/login-lockout.service";
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
import { EMAIL_VERIFICATION_OTP_PURPOSE } from "@/features/auth/otp/otp-purposes";
import type { UsernameBloomService } from "@/features/auth/username-bloom/username-bloom.service";
import { OtpService } from "@/features/auth/otp/otp.service";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { TokenService } from "@/features/auth/token/token.service";
import type { AuthPrincipal } from "@/features/auth/auth.principal";
import { loggerFactory, type Logger } from "@/configuration/logging";

export class LocalAuthService {
  private readonly logger: Logger;

  constructor(
    private readonly usersRepository: UsersRepository,
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
    private readonly usernameService: UsernameService,
    private readonly loginLockoutService: LoginLockoutService,
  ) {
    this.logger = loggerFactory.forClass(LocalAuthService, "service");
  }

  async localAuthenticate(
    input: LocalAuthenticateInput,
  ): Promise<AuthSessionResult> {
    const user = await this.usersRepository.findUserByUsername(input.username);
    const isPasswordValid = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    const loginAttemptRecord = await this.loginLockoutService.getAttemptRecord(
      input.username,
    );

    if (loginAttemptRecord?.lockedAt && (!user || !isPasswordValid)) {
      await this.loginLockoutService.sendUnlockCode(user);
      throw new LockedError(
        "This sign-in is locked. Use the code we emailed you to unlock it.",
        this.loginLockoutService.buildLockedLoginDetails(user),
      );
    }

    if (!user || !isPasswordValid) {
      const updatedAttemptRecord =
        await this.loginLockoutService.recordFailedAttempt(input.username);

      if (updatedAttemptRecord.lockedAt) {
        await this.loginLockoutService.sendUnlockCode(user);
        throw new LockedError(
          "This sign-in is locked. Use the code we emailed you to unlock it.",
          this.loginLockoutService.buildLockedLoginDetails(user),
        );
      }

      throw new UnauthorizedError("Invalid username or password.");
    }

    await this.loginLockoutService.clearAttemptRecord(input.username);

    if (!user.emailVerified) {
      throw new UnauthorizedError(
        "Please verify your email address before signing in.",
      );
    }

    await requireLoginMfa(
      this.mfaTotpService,
      user.id,
      user.email,
      input.totpCode,
    );

    return this.authSessionService.authenticateVerifiedUser(user, input);
  }

  async localSignup(
    input: LocalSignupInput,
  ): Promise<SignupVerificationPendingResult> {
    const existingUser = await this.usersRepository.findUserByEmail(input.email);
    await this.usernameService.assertUsernameIsAvailable(
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

      const existingUser = await this.usersRepository.findUserByEmail(
        input.email,
      );
      let verifiedUser: AuthUserRecord;

      await this.usernameService.assertUsernameIsAvailable(
        pendingSignup.username,
        existingUser?.id,
        pendingSignup.email,
      );

      if (!existingUser) {
        const createdUser = await this.usersRepository.createLocalUser(
          {
            username: pendingSignup.username,
            email: pendingSignup.email,
            firstName: pendingSignup.firstName,
            lastName: pendingSignup.lastName,
          },
          pendingSignup.passwordHash,
        );
        await this.usersRepository.markEmailVerified(createdUser.id);
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
        verifiedUser = await this.usersRepository.activatePendingLocalUser(
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

    const user = await this.usersRepository.findUserByEmail(input.email);

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
}
