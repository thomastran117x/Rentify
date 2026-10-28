import ConflictError from "@/errors/http/conflict.error";
import InvalidMfaCodeError from "@/errors/http/invalid-mfa-code.error";
import LockedError from "@/errors/http/locked.error";
import LoginMfaChallengeInvalidError from "@/errors/http/login-mfa-challenge-invalid.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { asUuid } from "@/configuration/validation/uuid";
import type {
  AuthSessionResult,
  AuthUserRecord,
} from "@/features/auth/auth.model";
import {
  assertAccountIsActive,
  toBlockedAccountReasonCode,
} from "@/features/auth/account-status/account-status.guard";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { AuthAuditReasonCode } from "@/features/auth/audit/auth-audit.model";
import type {
  LoginAttemptAuditBase,
  LoginLockoutService,
} from "@/features/auth/lockout/login-lockout.service";
import type { LoginMfaChallengeStore } from "@/features/auth/mfa/login/login-mfa-challenge.store";
import type {
  CompleteLoginMfaInput,
  LoginMfaChallengeRecord,
} from "@/features/auth/mfa/login/login-mfa.model";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import type { AuthSessionService } from "@/features/auth/session/session.service";
import type { UsersRepository } from "@/features/auth/users/users.repository";

/** Wrong codes one challenge accepts before the user has to sign in again. */
export const MAX_LOGIN_MFA_CHALLENGE_ATTEMPTS = 5;

/**
 * The second step of a sign-in, shared by password and social sign-in. The
 * first step left a challenge naming the user, method and device; this checks
 * the code against it and issues the session the first step held back.
 *
 * Audit events match what the one-request flow records for the same method,
 * so `login.*` for a password sign-in and `oauth.login.*` for a provider one.
 */
export class LoginMfaService {
  private readonly logger: Logger;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly loginMfaChallengeStore: LoginMfaChallengeStore,
    private readonly mfaTotpService: MfaTotpService,
    private readonly mfaVerificationService: MfaVerificationService,
    private readonly authSessionService: AuthSessionService,
    private readonly loginLockoutService: LoginLockoutService,
    private readonly authAuditService: AuthAuditService,
  ) {
    this.logger = loggerFactory.forClass(LoginMfaService, "service");
  }

  async completeLoginMfa(
    input: CompleteLoginMfaInput,
  ): Promise<AuthSessionResult> {
    const completionLock =
      await this.loginMfaChallengeStore.acquireCompletionLock(
        input.mfaChallengeToken,
      );

    if (!completionLock) {
      throw new ConflictError("This sign-in is already being verified.");
    }

    try {
      const challenge = await this.loginMfaChallengeStore.read(
        input.mfaChallengeToken,
      );

      if (!challenge) {
        throw new LoginMfaChallengeInvalidError();
      }

      const audit: LoginAttemptAuditBase = {
        method: challenge.method,
        identifierHash: challenge.identifierHash,
        context: input.audit,
      };

      // Left in place: the device the challenge belongs to can still use it.
      if (challenge.deviceId !== input.deviceId) {
        await this.recordFailure(challenge, audit, "token_invalid");
        throw new LoginMfaChallengeInvalidError();
      }

      const user = await this.requireChallengeUser(
        input.mfaChallengeToken,
        challenge,
        audit,
      );

      if (await this.loginLockoutService.isLocked(challenge.username)) {
        await this.loginMfaChallengeStore.delete(input.mfaChallengeToken);
        await this.loginLockoutService.recordLockedLogin(user, audit);
        await this.loginLockoutService.throwLockedLogin(user);
      }

      await this.verifyCode(input, challenge, user, audit);

      await this.loginMfaChallengeStore.delete(input.mfaChallengeToken);
      await this.loginLockoutService.clearAttemptRecord(challenge.username);

      const session = await this.authSessionService.authenticateVerifiedUser(
        user,
        {
          client: input.client,
          deviceId: challenge.deviceId,
          rememberMe: challenge.rememberMe,
          audit: input.audit,
        },
      );

      await this.recordDeviceLoginProof(user, session, input);
      await this.authAuditService.recordSafely({
        ...audit,
        eventType:
          challenge.method === "password"
            ? "login.succeeded"
            : "oauth.login.succeeded",
        outcome: "success",
        userId: asUuid(user.id),
        sessionId: session.sessionId,
      });

      return session;
    } finally {
      await completionLock.release();
    }
  }

  /**
   * The account must still be the one the first step proved: gone, blocked, or
   * signed out everywhere since then each void the challenge.
   */
  private async requireChallengeUser(
    token: string,
    challenge: LoginMfaChallengeRecord,
    audit: LoginAttemptAuditBase,
  ): Promise<AuthUserRecord> {
    const user = await this.usersRepository.findUserById(challenge.userId);

    if (!user || user.tokenVersion !== challenge.tokenVersion) {
      await this.loginMfaChallengeStore.delete(token);
      await this.recordFailure(challenge, audit, "token_invalid");
      throw new LoginMfaChallengeInvalidError();
    }

    if (user.status !== "active") {
      await this.loginMfaChallengeStore.delete(token);
      await this.authAuditService.recordSafely({
        ...audit,
        eventType: this.failureEventType(challenge),
        outcome: "blocked",
        reasonCode: toBlockedAccountReasonCode(user.status),
        userId: asUuid(user.id),
      });
      assertAccountIsActive(user);
    }

    return user;
  }

  /**
   * A wrong code uses up one of the challenge's attempts and counts towards
   * the username lockout, exactly as a wrong one-request code does.
   */
  private async verifyCode(
    input: CompleteLoginMfaInput,
    challenge: LoginMfaChallengeRecord,
    user: AuthUserRecord,
    audit: LoginAttemptAuditBase,
  ): Promise<void> {
    try {
      await this.mfaTotpService.verifyCode(asUuid(user.id), input.code);
      return;
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
    }

    const failedAttempts = challenge.failedAttempts + 1;

    if (failedAttempts >= MAX_LOGIN_MFA_CHALLENGE_ATTEMPTS) {
      await this.loginMfaChallengeStore.delete(input.mfaChallengeToken);
    } else {
      await this.loginMfaChallengeStore.update(input.mfaChallengeToken, {
        ...challenge,
        failedAttempts,
      });
    }

    try {
      await this.loginLockoutService.recordFailedLogin({
        username: challenge.username,
        user,
        reasonCode: "mfa_invalid",
        audit,
        failureEventType: this.failureEventType(challenge),
      });
    } catch (error) {
      if (error instanceof LockedError) {
        await this.loginMfaChallengeStore.delete(input.mfaChallengeToken);
      }
      throw error;
    }

    throw new InvalidMfaCodeError("The authenticator code is incorrect.");
  }

  /**
   * Best effort: the session is already issued, and without the proof the
   * new-device check only asks for a factor again.
   */
  private async recordDeviceLoginProof(
    user: AuthUserRecord,
    session: AuthSessionResult,
    input: CompleteLoginMfaInput,
  ): Promise<void> {
    if (!session.sessionId) {
      return;
    }

    try {
      await this.mfaVerificationService.recordLoginProof({
        userId: asUuid(user.id),
        sessionId: session.sessionId,
        factor: input.factor,
      });
    } catch (error) {
      this.logger.error("Failed to record the device-login MFA proof.", {
        userId: user.id,
        error,
      });
    }
  }

  private async recordFailure(
    challenge: LoginMfaChallengeRecord,
    audit: LoginAttemptAuditBase,
    reasonCode: AuthAuditReasonCode,
  ): Promise<void> {
    await this.authAuditService.recordSafely({
      ...audit,
      eventType: this.failureEventType(challenge),
      outcome: "failure",
      reasonCode,
      userId: challenge.userId,
    });
  }

  private failureEventType(
    challenge: LoginMfaChallengeRecord,
  ): "login.failed" | "oauth.login.failed" {
    return challenge.method === "password"
      ? "login.failed"
      : "oauth.login.failed";
  }
}
