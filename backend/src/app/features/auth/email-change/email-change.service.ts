import { createHash } from "node:crypto";
import { loggerFactory, type Logger } from "@/configuration/logging";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { Uuid } from "@/configuration/validation/uuid";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import EmailChangeAddressUnavailableError from "@/errors/http/email-change-address-unavailable.error";
import EmailChangeNotPendingError from "@/errors/http/email-change-not-pending.error";
import EmailChangeSameAddressError from "@/errors/http/email-change-same-address.error";
import type {
  AuthSessionResult,
  AuthUserRecord,
} from "@/features/auth/auth.model";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { TokenRepository } from "@/features/auth/token/token.repository";
import type { AuthSessionService } from "@/features/auth/session/session.service";
import type { EmailAvailabilityService } from "@/features/auth/email-availability/email-availability.service";
import type { IdentityBloomService } from "@/features/auth/identity-bloom/identity-bloom.service";
import type { EmailService } from "@/features/email/email.service";
import type { OtpService } from "@/features/auth/otp/otp.service";
import { EMAIL_CHANGE_OTP_PURPOSE } from "@/features/auth/otp/otp-purposes";
import { redactEmail } from "@/features/auth/redact-email";
import type { EmailChangeStore } from "@/features/auth/email-change/email-change.store";
import type {
  ConfirmEmailChangeInput,
  EmailChangeRequestResult,
  PendingEmailChangeResult,
  RequestEmailChangeInput,
  ResendEmailChangeCodeInput,
} from "@/features/auth/email-change/email-change.model";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";

/**
 * Moving an account to a new email address.
 *
 * The address is the account's primary identifier and its recovery channel, so
 * the flow demands two independent proofs. Starting a request needs a recent MFA
 * step-up, enforced by the controller; finishing one needs a code delivered to
 * the new address, enforced here. The first proves the session belongs to the
 * account holder, the second proves the account holder can actually receive mail
 * at the address they typed — without which a typo would silently lock them out.
 *
 * Only `requestChange` is MFA-gated. `confirmChange` deliberately is not, and
 * cannot be: the MFA proof cache stamps every proof with a hash over the user's
 * email and token version, so the write this method performs invalidates the
 * caller's own proof. Requiring one here would also strand any user whose
 * fifteen-minute proof lapsed while they fetched the code from another inbox.
 * The pending record is only creatable behind the gate, which is what carries
 * the guarantee forward to this step.
 */
export class EmailChangeService {
  private readonly logger: Logger;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly tokenRepository: TokenRepository,
    private readonly emailChangeStore: EmailChangeStore,
    private readonly emailAvailabilityService: EmailAvailabilityService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
    private readonly authSessionService: AuthSessionService,
    private readonly emailBloomService: IdentityBloomService,
    private readonly authAuditService: AuthAuditService,
  ) {
    this.logger = loggerFactory.forClass(EmailChangeService, "service");
  }

  async requestChange(
    input: RequestEmailChangeInput,
  ): Promise<EmailChangeRequestResult> {
    const user = await this.requireUser(input.userId);
    const newEmail = input.newEmail.trim().toLowerCase();

    if (user.email.trim().toLowerCase() === newEmail) {
      throw new EmailChangeSameAddressError();
    }

    await this.assertAddressClaimable(newEmail, input.userId);

    const previous = await this.emailChangeStore.read(input.userId);
    const ttlInSeconds = this.otpService.getTtlInSeconds();

    if (
      !(await this.emailChangeStore.reserveAddress(
        newEmail,
        input.userId,
        ttlInSeconds,
      ))
    ) {
      this.logSecurityEvent("Email change request rejected", {
        userId: input.userId,
        client: input.client,
        result: "address-reserved-by-other",
        targetEmail: newEmail,
      });
      throw new EmailChangeAddressUnavailableError();
    }

    let code: string;
    let resendAvailableInSeconds: number;

    try {
      const issued = await this.otpService.issue({
        purpose: EMAIL_CHANGE_OTP_PURPOSE,
        subject: newEmail,
      });
      code = issued.code;
      resendAvailableInSeconds = issued.resendAvailableInSeconds;
    } catch (error) {
      // The reservation was taken a moment ago for a request that is not going
      // to happen. Releasing it keeps a rate-limited retry from colliding with
      // the user's own abandoned claim.
      if (!previous || previous.newEmail !== newEmail) {
        await this.emailChangeStore.releaseAddress(newEmail, input.userId);
      }

      throw error;
    }

    await this.emailChangeStore.write(
      {
        userId: input.userId,
        currentEmail: user.email,
        newEmail,
        requestedAt: new Date().toISOString(),
      },
      ttlInSeconds,
    );

    // Retargeting a request abandons the previous address, so the claim on it
    // has to go rather than idling out over the next ten minutes.
    if (previous && previous.newEmail !== newEmail) {
      await this.emailChangeStore.releaseAddress(
        previous.newEmail,
        input.userId,
      );
    }

    // A reservation makes the address unavailable just as surely as a row does,
    // and `resolveEmailAvailabilityHint` skips the authoritative lookup entirely
    // on a filter miss. Without this the availability endpoint would report an
    // address being actively claimed as free. The 6-hour rebuild only folds in
    // the signup reservation prefix, so this bit is best-effort until the
    // address becomes a row — acceptable, because every path that writes or
    // mails re-checks authoritatively.
    await this.emailBloomService.add(newEmail);

    await this.sendChangeCode(user, newEmail, code, ttlInSeconds);

    // The old inbox is told every time a request starts, because that is the
    // one channel a session hijacker does not control. Only the first request
    // for a given target is silent on retries — see `resendCode`.
    await this.emailService.sendEmailChangeNoticeEmail({
      to: user.email,
      firstName: user.firstName,
      newEmail: redactEmail(newEmail),
    });

    this.logSecurityEvent("Email change requested", {
      userId: input.userId,
      client: input.client,
      result: "code-sent",
      targetEmail: newEmail,
    });

    return {
      newEmail: redactEmail(newEmail),
      expiresInSeconds: ttlInSeconds,
      resendAvailableInSeconds,
    };
  }

  async resendCode(
    input: ResendEmailChangeCodeInput,
  ): Promise<EmailChangeRequestResult> {
    const user = await this.requireUser(input.userId);
    const pending = await this.emailChangeStore.read(input.userId);

    if (!pending) {
      throw new EmailChangeNotPendingError();
    }

    // Re-checked rather than trusted: the address was free when the request
    // started, but another account can have taken it since.
    await this.assertAddressClaimable(pending.newEmail, input.userId);

    const ttlInSeconds = this.otpService.getTtlInSeconds();
    const issued = await this.otpService.issue({
      purpose: EMAIL_CHANGE_OTP_PURPOSE,
      subject: pending.newEmail,
    });

    // The new code carries a full TTL of its own, so the record and the
    // reservation have to be pushed out to match. Left alone they would keep
    // the deadline set by the original request, and a code resent late in the
    // window would stop working minutes before it expired — the user would be
    // holding a live code against a request that no longer exists.
    await this.emailChangeStore.write(pending, ttlInSeconds);
    await this.emailChangeStore.reserveAddress(
      pending.newEmail,
      input.userId,
      ttlInSeconds,
    );

    await this.sendChangeCode(
      user,
      pending.newEmail,
      issued.code,
      ttlInSeconds,
    );

    this.logSecurityEvent("Email change code resent", {
      userId: input.userId,
      client: input.client,
      result: "code-sent",
      targetEmail: pending.newEmail,
    });

    return {
      newEmail: redactEmail(pending.newEmail),
      expiresInSeconds: ttlInSeconds,
      resendAvailableInSeconds: issued.resendAvailableInSeconds,
    };
  }

  async confirmChange(
    input: ConfirmEmailChangeInput,
  ): Promise<AuthSessionResult> {
    const pending = await this.emailChangeStore.read(input.userId);

    if (!pending) {
      throw new EmailChangeNotPendingError();
    }

    // Verified before the lock is taken, so a wrong code costs nothing beyond
    // its own attempt. Throws on a wrong or expired code.
    await this.otpService.verify({
      purpose: EMAIL_CHANGE_OTP_PURPOSE,
      subject: pending.newEmail,
      code: input.code,
    });

    // `OtpService.verify` reads the code and then deletes it, so two submissions
    // racing each other can both see it as valid. Without this lock both would
    // go on to rotate the token version, and the second rotation would invalidate
    // the session the first one just handed back.
    const lock = await this.emailChangeStore.acquireConfirmLock(input.userId);

    if (!lock) {
      throw new EmailChangeNotPendingError();
    }

    try {
      // Re-read inside the lock: the request may have been cancelled, or another
      // session may have finished the same change, between the OTP check and here.
      const confirmed = await this.emailChangeStore.read(input.userId);

      if (!confirmed) {
        throw new EmailChangeNotPendingError();
      }

      // The code was checked against the target as it stood a moment ago. If the
      // request has been retargeted since, that code proves control of an
      // address this call is no longer about — so it must not authorise the new
      // one. Refuse rather than write; the user still holds a live code for the
      // address they actually asked for.
      if (confirmed.newEmail !== pending.newEmail) {
        throw new EmailChangeNotPendingError(
          "This email change was updated while you were confirming. Request a new code.",
        );
      }

      const user = await this.requireUser(input.userId);

      if (user.email !== confirmed.currentEmail) {
        await this.emailChangeStore.clear(input.userId);
        throw new EmailChangeNotPendingError(
          "The email on this account has already changed. Start a new request.",
        );
      }

      // The last authoritative check before the write. A code proves the address
      // was reachable ten minutes ago, not that it is still unclaimed.
      try {
        await this.assertAddressClaimable(confirmed.newEmail, input.userId);
      } catch (error) {
        await this.emailChangeStore.clear(input.userId);
        throw error;
      }

      await this.usersRepository.updateUserEmail(
        input.userId,
        confirmed.newEmail,
      );
      await this.emailBloomService.add(confirmed.newEmail);
      await this.emailChangeStore.clear(input.userId);

      // Rotating the token version kills every other session on the account, the
      // same treatment a password change gets: if the request was made from a
      // stolen session, the address moving is exactly when the real owner's other
      // sessions should stop being trusted.
      const nextTokenVersion = await this.tokenRepository.rotateTokenVersion(
        input.userId,
      );

      this.logSecurityEvent("Email change confirmed", {
        userId: input.userId,
        client: input.client,
        result: "email-updated",
        targetEmail: confirmed.newEmail,
        previousEmail: confirmed.currentEmail,
      });

      const updatedUser: AuthUserRecord = {
        ...user,
        email: confirmed.newEmail,
        emailVerified: true,
        tokenVersion: nextTokenVersion,
      };

      const session = await this.authSessionService.reissueSessionForUser(
        updatedUser,
        input.client,
        input.deviceId,
        input.audit,
      );
      await this.authAuditService.recordSafely({
        eventType: "email.changed",
        outcome: "success",
        userId: input.userId,
        sessionId: session.sessionId,
        context: input.audit,
        metadata: {
          oldEmailMasked: redactEmail(confirmed.currentEmail),
          newEmailMasked: redactEmail(confirmed.newEmail),
        },
      });
      return session;
    } finally {
      await lock.release();
    }
  }

  async readPending(userId: Uuid): Promise<PendingEmailChangeResult> {
    const pending = await this.emailChangeStore.read(userId);

    if (!pending) {
      return { pending: false };
    }

    return {
      pending: true,
      newEmail: redactEmail(pending.newEmail),
      expiresInSeconds: await this.emailChangeStore.readTtlInSeconds(userId),
    };
  }

  async cancelChange(userId: Uuid): Promise<void> {
    await this.emailChangeStore.clear(userId);
  }

  /**
   * Reads back the code for the address change currently in flight.
   *
   * Non-production only — the route is not registered otherwise. Local and test
   * environments suppress delivery to `@rentify.local`, so without this there is
   * no way to drive the flow end to end against seeded accounts.
   */
  async previewPendingCode(
    userId: Uuid,
  ): Promise<{ code: string; expiresInSeconds: number } | null> {
    const pending = await this.emailChangeStore.read(userId);

    if (!pending) {
      return null;
    }

    return this.otpService.peek({
      purpose: EMAIL_CHANGE_OTP_PURPOSE,
      subject: pending.newEmail,
    });
  }

  private async requireUser(userId: Uuid): Promise<AuthUserRecord> {
    const user = await this.usersRepository.findUserById(userId);

    if (!user) {
      throw new UnauthorizedError("Session is no longer valid.");
    }

    return user;
  }

  /**
   * Authoritative, never the bloom hint.
   *
   * A `definitely-absent` verdict from the filter is advisory, and this path
   * both sends mail and decides a conflict — precisely the two things the filter
   * documentation says a verdict must not be allowed to short-circuit.
   *
   * An in-flight signup on the same address is deliberately allowed through,
   * matching what signup itself does with a half-finished attempt: the
   * reservation is advisory, and the unique index on `users.email` is what
   * actually decides the race. Whichever side commits second gets a conflict
   * from the database rather than a wrong answer from the cache.
   */
  private async assertAddressClaimable(
    email: string,
    userId: Uuid,
  ): Promise<void> {
    const availability = await this.emailAvailabilityService.isEmailAvailable(
      email,
      userId,
    );

    if (!availability.available) {
      throw new EmailChangeAddressUnavailableError();
    }
  }

  private async sendChangeCode(
    user: AuthUserRecord,
    newEmail: string,
    code: string,
    ttlInSeconds: number,
  ): Promise<void> {
    await this.emailService.sendEmailChangeCodeEmail({
      to: newEmail,
      verificationCode: code,
      firstName: user.firstName,
      expiresInMinutes: Math.round(ttlInSeconds / 60),
    });
  }

  private logSecurityEvent(
    message: string,
    input: {
      userId: Uuid;
      client?: ClientRequestContext;
      result: string;
      targetEmail: string;
      previousEmail?: string;
    },
  ): void {
    this.logger.info(message, {
      userId: input.userId,
      result: input.result,
      targetEmail: redactEmail(input.targetEmail),
      previousEmail: input.previousEmail
        ? redactEmail(input.previousEmail)
        : undefined,
      ipHash: this.hashOptionalValue(input.client?.ip),
      userAgentHash: this.hashOptionalValue(input.client?.device.userAgent),
      timestamp: new Date().toISOString(),
    });
  }

  private hashOptionalValue(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    return createHash("sha256").update(value).digest("hex");
  }
}
