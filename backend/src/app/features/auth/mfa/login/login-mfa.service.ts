import ConflictError from "@/errors/http/conflict.error";
import InvalidMfaCodeError from "@/errors/http/invalid-mfa-code.error";
import LockedError from "@/errors/http/locked.error";
import LoginMfaRequiredError from "@/errors/http/login-mfa-required.error";
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
import { isMfaBypassEligible } from "@/features/auth/mfa/mfa-bypass";
import type { LoginMfaChallengeStore } from "@/features/auth/mfa/login/login-mfa-challenge.store";
import type {
  BeginLoginPasskeyInput,
  CompleteLoginMfaInput,
  LoginMfaAnswer,
  LoginMfaChallengeRecord,
  LoginMfaFactor,
  LoginMfaMethod,
} from "@/features/auth/mfa/login/login-mfa.model";
import {
  hasStrongFactor,
  type MfaFactorRepository,
  type MfaFactorSummary,
} from "@/features/auth/mfa/mfa-factor.repository";
import type { PasskeyAssertionOptionsResult } from "@/features/auth/mfa/passkey/passkey.model";
import type { PasskeyService } from "@/features/auth/mfa/passkey/passkey.service";
import type { MfaRecoveryCodeService } from "@/features/auth/mfa/recovery/mfa-recovery-code.service";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import { redactEmail } from "@/features/auth/redact-email";
import type { AuthSessionService } from "@/features/auth/session/session.service";
import type { UsersRepository } from "@/features/auth/users/users.repository";

const INVALID_CODE_MESSAGES: Record<LoginMfaFactor, string> = {
  passkey: "That passkey could not be verified.",
  totp: "The authenticator code is incorrect.",
  recovery_code: "That recovery code is incorrect or was already used.",
};

/** The factors a sign-in may be finished with, strongest first. */
function loginFactorsFor(factors: MfaFactorSummary): LoginMfaFactor[] {
  return [
    ...(factors.passkeyCount > 0 ? (["passkey"] as const) : []),
    ...(factors.totpActive ? (["totp"] as const) : []),
    ...(factors.unusedRecoveryCodes > 0 ? (["recovery_code"] as const) : []),
  ];
}

/**
 * What the second factor decided about a sign-in whose first factor passed.
 * `verified` carries the factor so the caller can record it against the
 * session it then issues. A sign-in that still needs a code never gets here:
 * it is refused with a {@link LoginMfaRequiredError} carrying the challenge.
 */
export type LoginMfaOutcome =
  | { status: "not_required" }
  | { status: "verified"; factor: LoginMfaFactor };

export interface EvaluateLoginMfaInput {
  user: AuthUserRecord;
  method: LoginMfaMethod;
  audit: LoginAttemptAuditBase;
  /** The deprecated one-request form; omitted by clients that use challenges. */
  totpCode?: string;
  deviceId?: string;
  rememberMe?: boolean;
}

/**
 * The login-time second factor for every sign-in method. Distinct from
 * {@link import("@/features/auth/mfa/verification/mfa-verification.guard").requireRecentMfaVerification},
 * which re-checks an already-authenticated session before a sensitive action.
 *
 * This is the one place that checks the username lock before a code, counts a
 * wrong code towards it, clears it once a code checks out, and records the
 * verified factor as the session's device-login proof, whether the code came
 * with the first step or through `POST /auth/login/mfa`.
 *
 * Audit events follow the method of the first step: `login.*` for a password
 * sign-in and `oauth.login.*` for a provider one.
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
    private readonly mfaRecoveryCodeService: MfaRecoveryCodeService,
    private readonly mfaFactorRepository: Pick<
      MfaFactorRepository,
      "getSummary"
    >,
    private readonly passkeyService: Pick<
      PasskeyService,
      "beginAssertion" | "verifyAssertion"
    >,
  ) {
    this.logger = loggerFactory.forClass(LoginMfaService, "service");
  }

  /**
   * Runs once the first factor (password or provider) has passed. Without a
   * code, an account with a strong factor (a passkey or an authenticator) is
   * refused with a challenge instead of a session; with an authenticator
   * code, the code is checked here and now.
   */
  async evaluateFirstStep(
    input: EvaluateLoginMfaInput,
  ): Promise<LoginMfaOutcome> {
    const userId = asUuid(input.user.id);

    if (isMfaBypassEligible(input.user.email)) {
      this.logger.info("MFA bypass used", {
        userId,
        email: redactEmail(input.user.email),
        result: "bypass",
        timestamp: new Date().toISOString(),
      });
      return { status: "not_required" };
    }

    const factors = await this.mfaFactorRepository.getSummary(userId);

    if (!hasStrongFactor(factors)) {
      return { status: "not_required" };
    }

    await this.refuseIfLocked(input.user, input.audit);

    if (input.totpCode) {
      await this.verifyCode(
        input.user,
        input.audit,
        this.failureEventType(input.method),
        { factor: "totp", code: input.totpCode },
      );
      return { status: "verified", factor: "totp" };
    }

    // The first factor passed; the client must now ask for a code. Recorded
    // as a success so an MFA user's activity does not show a failed sign-in
    // before every real one.
    await this.authAuditService.recordSafely({
      ...input.audit,
      eventType: "login.mfa_challenged",
      outcome: "success",
      reasonCode: "mfa_required",
      userId,
    });

    throw new LoginMfaRequiredError(
      await this.loginMfaChallengeStore.issue(
        {
          userId,
          method: input.method,
          username: input.user.profile.username,
          identifierHash: input.audit.identifierHash,
          deviceId: input.deviceId,
          rememberMe: input.rememberMe,
          tokenVersion: input.user.tokenVersion,
        },
        loginFactorsFor(factors),
      ),
    );
  }

  /**
   * Request options for finishing the sign-in with a passkey. The challenge
   * is bound to the sign-in's token and lasts no longer than the sign-in
   * itself; asking again replaces it, so a cancelled prompt can be retried.
   */
  async beginPasskey(
    input: BeginLoginPasskeyInput,
  ): Promise<PasskeyAssertionOptionsResult> {
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

    if (challenge.deviceId !== input.deviceId) {
      await this.recordFailure(challenge, audit, "token_invalid");
      throw new LoginMfaChallengeInvalidError();
    }

    const user = await this.requireChallengeUser(
      input.mfaChallengeToken,
      challenge,
      audit,
    );
    await this.refuseIfLocked(user, audit);

    const remainingSeconds = Math.floor(
      (Date.parse(challenge.createdAt) +
        this.loginMfaChallengeStore.getTtlInSeconds() * 1000 -
        Date.now()) /
        1000,
    );

    if (remainingSeconds < 1) {
      throw new LoginMfaChallengeInvalidError();
    }

    return {
      options: await this.passkeyService.beginAssertion({
        userId: challenge.userId,
        purpose: "login",
        binding: input.mfaChallengeToken,
        ttlSeconds: remainingSeconds,
      }),
    };
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

      let recoveryCodesRemaining: number | undefined;

      try {
        await this.refuseIfLocked(user, audit);
        recoveryCodesRemaining = await this.verifyCode(
          user,
          audit,
          this.failureEventType(challenge.method),
          input,
          input.mfaChallengeToken,
        );
      } catch (error) {
        if (error instanceof LockedError) {
          // The lock outlives the challenge, so a later code could never
          // finish this sign-in anyway.
          await this.loginMfaChallengeStore.delete(input.mfaChallengeToken);
        }
        if (error instanceof UnauthorizedError) {
          throw new InvalidMfaCodeError(INVALID_CODE_MESSAGES[input.factor]);
        }
        throw error;
      }

      await this.loginMfaChallengeStore.delete(input.mfaChallengeToken);

      const session = await this.authSessionService.authenticateVerifiedUser(
        user,
        {
          client: input.client,
          deviceId: challenge.deviceId,
          rememberMe: challenge.rememberMe,
          audit: input.audit,
        },
      );

      await this.recordVerifiedSignIn(user, session, input.factor);
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

      return recoveryCodesRemaining === undefined
        ? session
        : { ...session, recoveryCodesRemaining };
    } finally {
      await completionLock.release();
    }
  }

  /**
   * Records the factor a sign-in was completed with as the new session's
   * device-login proof, so the new-device check that follows does not ask for
   * the same factor again. Best effort: the session is already issued, and
   * without the proof the check only asks for a factor again.
   */
  async recordVerifiedSignIn(
    user: AuthUserRecord,
    session: AuthSessionResult,
    factor: LoginMfaFactor,
  ): Promise<void> {
    if (!session.sessionId) {
      return;
    }

    try {
      await this.mfaVerificationService.recordLoginProof({
        userId: asUuid(user.id),
        sessionId: session.sessionId,
        factor,
      });
    } catch (error) {
      this.logger.error("Failed to record the device-login MFA proof.", {
        userId: user.id,
        error,
      });
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
        eventType: this.failureEventType(challenge.method),
        outcome: "blocked",
        reasonCode: toBlockedAccountReasonCode(user.status),
        userId: asUuid(user.id),
      });
      assertAccountIsActive(user);
    }

    return user;
  }

  /** A locked username gets no code checked, right or wrong. */
  private async refuseIfLocked(
    user: AuthUserRecord,
    audit: LoginAttemptAuditBase,
  ): Promise<void> {
    if (await this.loginLockoutService.isLocked(user.profile.username)) {
      await this.loginLockoutService.recordLockedLogin(user, audit);
      await this.loginLockoutService.throwLockedLogin(user);
    }
  }

  /**
   * A wrong code, or a refused passkey assertion, counts towards the
   * username lockout and rethrows the rejection, whichever factor it was for;
   * a right one clears the count the way a sign-in does.
   *
   * `mfaChallengeToken` is what a passkey challenge was bound to.
   *
   * Returns how many recovery codes are left when one was spent.
   */
  private async verifyCode(
    user: AuthUserRecord,
    audit: LoginAttemptAuditBase,
    failureEventType: "login.failed" | "oauth.login.failed",
    answer: LoginMfaAnswer,
    mfaChallengeToken?: string,
  ): Promise<number | undefined> {
    const userId = asUuid(user.id);
    let recoveryCodesRemaining: number | undefined;

    try {
      if (answer.factor === "passkey") {
        // A passkey only ever answers the second step, never the first.
        if (!mfaChallengeToken) {
          throw new UnauthorizedError("MFA verification failed.");
        }
        await this.passkeyService.verifyAssertion({
          userId,
          purpose: "login",
          binding: mfaChallengeToken,
          credential: answer.credential,
          method: audit.method,
          context: audit.context,
        });
      } else if (answer.factor === "recovery_code") {
        recoveryCodesRemaining = await this.mfaRecoveryCodeService.redeem({
          userId,
          code: answer.code,
          stage: "login",
          method: audit.method,
          context: audit.context,
        });
      } else {
        await this.mfaTotpService.verifyCode(userId, answer.code);
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        await this.loginLockoutService.recordFailedLogin({
          username: user.profile.username,
          user,
          reasonCode: "mfa_invalid",
          audit,
          failureEventType,
        });
      }
      throw error;
    }

    await this.loginLockoutService.clearAttemptRecord(user.profile.username);

    return recoveryCodesRemaining;
  }

  private async recordFailure(
    challenge: LoginMfaChallengeRecord,
    audit: LoginAttemptAuditBase,
    reasonCode: AuthAuditReasonCode,
  ): Promise<void> {
    await this.authAuditService.recordSafely({
      ...audit,
      eventType: this.failureEventType(challenge.method),
      outcome: "failure",
      reasonCode,
      userId: challenge.userId,
    });
  }

  private failureEventType(
    method: LoginMfaMethod,
  ): "login.failed" | "oauth.login.failed" {
    return method === "password" ? "login.failed" : "oauth.login.failed";
  }
}
