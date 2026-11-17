import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import PasskeyLoginFailedError from "@/errors/http/passkey-login-failed.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { asUuid } from "@/configuration/validation/uuid";
import type { AuthSessionResult } from "@/features/auth/auth.model";
import {
  assertAccountIsActive,
  toBlockedAccountReasonCode,
} from "@/features/auth/account-status/account-status.guard";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type {
  LoginAttemptAuditBase,
  LoginLockoutService,
} from "@/features/auth/lockout/login-lockout.service";
import type { LoginMfaService } from "@/features/auth/mfa/login/login-mfa.service";
import type { PasskeyService } from "@/features/auth/mfa/passkey/passkey.service";
import type { AuthSessionService } from "@/features/auth/session/session.service";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { PasskeyLoginInput } from "./passkey-login.model";

export interface PasskeyLoginServiceOptions {
  passkeyService: Pick<
    PasskeyService,
    "beginDiscoverableAssertion" | "verifyDiscoverableAssertion"
  >;
  usersRepository: Pick<UsersRepository, "findUserById">;
  loginLockoutService: Pick<
    LoginLockoutService,
    | "getAttemptRecord"
    | "recordLockedLogin"
    | "throwLockedLogin"
    | "recordFailedLogin"
    | "clearAttemptRecord"
  >;
  authSessionService: Pick<AuthSessionService, "authenticateVerifiedUser">;
  loginMfaService: Pick<LoginMfaService, "recordVerifiedSignIn">;
  authAuditService: Pick<
    AuthAuditService,
    "recordSafely" | "hashIdentifier" | "hashPasskeyCredentialId"
  >;
}

/**
 * Signing in with a passkey alone (#466). A passkey that verified its user,
 * by biometric or PIN, is already two factors, so it replaces the password
 * and asks for nothing more: no authenticator code, whatever the account has.
 *
 * Everything else is the password sign-in's, in its order: the assertion is
 * checked, then the username lock (which refuses even a good passkey), then
 * the outcome, then the account status and email, which are told only to
 * someone who proved they hold the passkey. A refused assertion counts
 * towards the lockout like a wrong password. The session goes through
 * {@link AuthSessionService.authenticateVerifiedUser}, so device evaluation,
 * new-device alerts and detection rule (c) apply as they do to passwords,
 * and the success is `login.succeeded` with method `passkey`.
 */
export class PasskeyLoginService {
  constructor(private readonly options: PasskeyLoginServiceOptions) {}

  async beginOptions(): Promise<{
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    return {
      options: await this.options.passkeyService.beginDiscoverableAssertion(),
    };
  }

  async authenticate(input: PasskeyLoginInput): Promise<AuthSessionResult> {
    const result =
      await this.options.passkeyService.verifyDiscoverableAssertion({
        credential: input.credential,
        context: input.audit,
      });
    const user = result.userId
      ? await this.options.usersRepository.findUserById(result.userId)
      : null;

    // No account to count against: recorded under the credential ID's hash,
    // which still lets credential stuffing be seen per IP.
    if (!user) {
      await this.options.authAuditService.recordSafely({
        eventType: "login.failed",
        outcome: "failure",
        reasonCode: "bad_credentials",
        method: "passkey",
        identifierHash: this.options.authAuditService.hashPasskeyCredentialId(
          input.credential.rawId,
        ),
        context: input.audit,
      });
      throw new PasskeyLoginFailedError();
    }

    const username = user.profile.username;
    // The username's hash, as a password sign-in records it, so the account's
    // attempts read as one stream whichever way they came.
    const audit: LoginAttemptAuditBase = {
      method: "passkey",
      identifierHash: this.options.authAuditService.hashIdentifier(username),
      context: input.audit,
    };
    const lockout = this.options.loginLockoutService;
    const attemptRecord = await lockout.getAttemptRecord(username);

    if (attemptRecord?.lockedAt) {
      await lockout.recordLockedLogin(user, audit);
      await lockout.throwLockedLogin(user);
    }

    if (result.status === "rejected") {
      await lockout.recordFailedLogin({
        username,
        user,
        reasonCode: "bad_credentials",
        audit,
      });
      throw new PasskeyLoginFailedError();
    }

    if (user.status !== "active") {
      await this.options.authAuditService.recordSafely({
        ...audit,
        eventType: "login.failed",
        outcome: "blocked",
        reasonCode: toBlockedAccountReasonCode(user.status),
        userId: asUuid(user.id),
      });
      assertAccountIsActive(user);
    }

    if (!user.emailVerified) {
      await this.options.authAuditService.recordSafely({
        ...audit,
        eventType: "login.failed",
        outcome: "failure",
        reasonCode: "email_unverified",
        userId: asUuid(user.id),
      });
      throw new UnauthorizedError(
        "Please verify your email address before signing in.",
      );
    }

    await lockout.clearAttemptRecord(username);

    const session =
      await this.options.authSessionService.authenticateVerifiedUser(user, {
        client: input.client,
        deviceId: input.deviceId,
        rememberMe: input.rememberMe,
        audit: input.audit,
      });

    // The passkey is the device-login proof, so the new-device check that
    // follows does not ask for a factor again.
    await this.options.loginMfaService.recordVerifiedSignIn(
      user,
      session,
      "passkey",
    );
    await this.options.authAuditService.recordSafely({
      ...audit,
      eventType: "login.succeeded",
      outcome: "success",
      userId: asUuid(user.id),
      sessionId: session.sessionId,
      metadata: { passkeyId: result.passkeyId },
    });

    return session;
  }
}
