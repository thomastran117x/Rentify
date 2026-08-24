import { createHash } from "node:crypto";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { environment } from "@/configuration/environment";
import BadRequestError from "@/errors/http/bad-request.error";
import InvalidMfaCodeError from "@/errors/http/invalid-mfa-code.error";
import MfaChallengeRateLimitedError from "@/errors/http/mfa-challenge-rate-limited.error";
import MfaConfirmRateLimitedError from "@/errors/http/mfa-confirm-rate-limited.error";
import MfaFactorUnavailableError from "@/errors/http/mfa-factor-unavailable.error";
import MfaVerificationRequiredError from "@/errors/http/mfa-verification-required.error";
import TooManyRequestError from "@/errors/http/too-many-request.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type {
  MfaVerificationRepository,
  MfaVerificationSecurityContext,
} from "@/features/auth/mfa/verification/mfa-verification.repository";
import type { OtpService } from "@/features/auth/otp/otp.service";
import type { CacheService } from "@/features/cache/cache.service";
import type { EmailService } from "@/features/email/email.service";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { isMfaBypassEligible } from "@/features/auth/mfa/mfa-bypass";
import {
  MFA_DEVICE_LOGIN_SCOPE,
  MFA_MANAGEMENT_SCOPE,
  MFA_PROOF_TTL_MINUTES,
  MFA_STEP_UP_OTP_PURPOSE,
  type MfaVerificationChallengeFactor,
  type MfaVerificationChallengeResult,
  type MfaVerificationConfirmResult,
  type MfaVerificationFactor,
  type MfaVerificationOptionsResult,
  type MfaVerificationPreviewResult,
  type MfaVerificationProofRecord,
  type MfaVerificationScope,
} from "./mfa-verification.model";

interface MfaVerificationServiceOptions {
  mfaVerificationRepository: MfaVerificationRepository;
  cache: CacheService;
  otpService: OtpService;
  emailService: EmailService;
  mfaTotpService: MfaTotpService;
}

interface VerificationRequestContext {
  userId: string;
  sessionId: string;
  scope: MfaVerificationScope;
  factor?: MfaVerificationFactor;
  client?: ClientRequestContext;
}

interface VerifiedFactorState {
  securityContext: MfaVerificationSecurityContext;
  availableFactors: MfaVerificationFactor[];
  recommendedFactor: MfaVerificationFactor | null;
  securityVersion: string;
  activeTotpAvailable: boolean;
}

const MFA_PROOF_TTL_MS = MFA_PROOF_TTL_MINUTES * 60 * 1000;
const CHALLENGE_WINDOW_SECONDS = 60;
const CHALLENGE_LIMIT = 5;
const CONFIRM_WINDOW_SECONDS = 60;
const CONFIRM_LIMIT = 10;
const FAILED_CONFIRM_THRESHOLD = 5;
const FAILED_CONFIRM_LOCK_SECONDS = 5 * 60;
const FAILED_CONFIRM_TTL_SECONDS = 10 * 60;

export class MfaVerificationService {
  private readonly logger: Logger;

  constructor(private readonly options: MfaVerificationServiceOptions) {
    this.logger = loggerFactory.forClass(MfaVerificationService, "service");
  }

  async getOptions(
    input: Pick<VerificationRequestContext, "userId" | "sessionId" | "scope">,
  ): Promise<MfaVerificationOptionsResult> {
    const factorState = await this.resolveFactorState(
      input.userId,
      input.scope,
    );

    if (isMfaBypassEligible(factorState.securityContext.email)) {
      return {
        scope: input.scope,
        verified: true,
        verifiedUntil: this.computeBypassVerifiedUntil(),
        availableFactors: factorState.availableFactors,
        recommendedFactor: factorState.recommendedFactor,
      };
    }

    const proof = await this.readProof(input.sessionId, input.scope);
    const validatedProof = await this.validateProof({
      proof,
      sessionId: input.sessionId,
      scope: input.scope,
      factorState,
      userId: input.userId,
    });

    return {
      scope: input.scope,
      verified: validatedProof !== null,
      verifiedUntil: validatedProof?.verifiedUntil ?? null,
      availableFactors: factorState.availableFactors,
      recommendedFactor: factorState.recommendedFactor,
    };
  }

  async issueChallenge(
    input: VerificationRequestContext & {
      factor: MfaVerificationFactor;
      client: ClientRequestContext;
    },
  ): Promise<MfaVerificationChallengeResult> {
    const factorState = await this.resolveFactorState(
      input.userId,
      input.scope,
    );
    const factor = this.requireUsableFactor(factorState, input.factor);

    await this.consumeWindowRateLimit({
      kind: "challenge",
      limit: CHALLENGE_LIMIT,
      windowSeconds: CHALLENGE_WINDOW_SECONDS,
      ...input,
      factor,
    });

    if (factor === "email") {
      const otpSubject = this.getOtpSubject(
        input.userId,
        input.sessionId,
        input.scope,
        factor,
      );

      try {
        const issuedOtp = await this.options.otpService.issue({
          purpose: MFA_STEP_UP_OTP_PURPOSE,
          subject: otpSubject,
        });

        await this.options.emailService.sendMfaStepUpEmail({
          to: factorState.securityContext.email,
          verificationCode: issuedOtp.code,
          firstName: factorState.securityContext.firstName,
        });

        const cooldownUntil = new Date(
          Date.now() + issuedOtp.resendAvailableInSeconds * 1000,
        ).toISOString();

        this.logSecurityEvent("MFA step-up challenge issued", {
          ...input,
          factor,
          result: "issued",
        });

        return {
          scope: input.scope,
          factor,
          challengeId: null,
          cooldownUntil,
        };
      } catch (error) {
        if (error instanceof TooManyRequestError) {
          this.logSecurityEvent("MFA step-up challenge failed", {
            ...input,
            factor,
            result: "cooldown",
          });

          throw new MfaChallengeRateLimitedError(undefined, error.details);
        }

        this.logSecurityEvent("MFA step-up challenge failed", {
          ...input,
          factor,
          result: "delivery-error",
        });
        throw error;
      }
    }

    this.logSecurityEvent("MFA step-up challenge issued", {
      ...input,
      factor,
      result: "prompt",
    });

    return {
      scope: input.scope,
      factor,
      challengeId: null,
      prompt: true,
    };
  }

  async confirmChallenge(
    input: VerificationRequestContext & {
      factor: MfaVerificationFactor;
      code: string;
      client: ClientRequestContext;
    },
  ): Promise<MfaVerificationConfirmResult> {
    const factorState = await this.resolveFactorState(
      input.userId,
      input.scope,
    );
    const factor = this.requireUsableFactor(factorState, input.factor);

    await this.assertConfirmLockNotActive(input, factor);
    await this.consumeWindowRateLimit({
      kind: "confirm",
      limit: CONFIRM_LIMIT,
      windowSeconds: CONFIRM_WINDOW_SECONDS,
      ...input,
      factor,
    });

    try {
      if (factor === "email") {
        await this.options.otpService.verify({
          purpose: MFA_STEP_UP_OTP_PURPOSE,
          subject: this.getOtpSubject(
            input.userId,
            input.sessionId,
            input.scope,
            factor,
          ),
          code: input.code,
        });
      } else {
        await this.options.mfaTotpService.verifyCode(input.userId, input.code);
      }
    } catch (error) {
      if (
        error instanceof BadRequestError ||
        error instanceof UnauthorizedError
      ) {
        await this.recordFailedConfirmAttempt(input, factor);
        this.logSecurityEvent("MFA step-up failed", {
          ...input,
          factor,
          result: "invalid-code",
        });
        throw new InvalidMfaCodeError();
      }

      throw error;
    }

    await this.clearConfirmAttemptState(input, factor);
    const proof = await this.persistProof({
      factor,
      factorState,
      scope: input.scope,
      sessionId: input.sessionId,
      userId: input.userId,
    });

    this.logSecurityEvent("MFA step-up succeeded", {
      ...input,
      factor,
      result: "verified",
    });

    return {
      verified: true,
      scope: input.scope,
      factor,
      verifiedUntil: proof.verifiedUntil,
    };
  }

  async assertRecentVerification(
    input: VerificationRequestContext & { client?: ClientRequestContext },
  ): Promise<MfaVerificationProofRecord> {
    const factorState = await this.resolveFactorState(
      input.userId,
      input.scope,
    );

    if (isMfaBypassEligible(factorState.securityContext.email)) {
      const bypassProof = this.buildBypassProof({
        userId: input.userId,
        sessionId: input.sessionId,
        scope: input.scope,
        factorState,
      });

      this.logSecurityEvent("MFA bypass used", {
        ...input,
        factor: bypassProof.factor,
        result: "bypass",
      });

      return bypassProof;
    }

    const proof = await this.readProof(input.sessionId, input.scope);
    const validatedProof = await this.validateProof({
      proof,
      sessionId: input.sessionId,
      scope: input.scope,
      factorState,
      userId: input.userId,
    });

    if (!validatedProof) {
      throw new MfaVerificationRequiredError({
        scope: input.scope,
        availableFactors: factorState.availableFactors,
        recommendedFactor: factorState.recommendedFactor,
        verifiedUntil: null,
      });
    }

    this.logSecurityEvent("MFA proof used", {
      ...input,
      factor: validatedProof.factor,
      result: "accepted",
    });

    return validatedProof;
  }

  async previewCurrentEmailOtp(
    input: Pick<VerificationRequestContext, "userId" | "sessionId" | "scope">,
  ): Promise<MfaVerificationPreviewResult> {
    if (environment.isProduction()) {
      throw new BadRequestError("OTP preview is unavailable.");
    }

    const factorState = await this.resolveFactorState(
      input.userId,
      input.scope,
    );

    if (!factorState.availableFactors.includes("email")) {
      throw new MfaFactorUnavailableError();
    }

    const preview = await this.options.otpService.peek({
      purpose: MFA_STEP_UP_OTP_PURPOSE,
      subject: this.getOtpSubject(
        input.userId,
        input.sessionId,
        input.scope,
        "email",
      ),
    });

    if (!preview) {
      throw new BadRequestError(
        "No active MFA verification code is available.",
      );
    }

    return {
      scope: input.scope,
      factor: "email",
      code: preview.code,
      expiresInSeconds: preview.expiresInSeconds,
    };
  }

  private async resolveFactorState(
    userId: string,
    scope: MfaVerificationScope,
  ): Promise<VerifiedFactorState> {
    this.assertSupportedScope(scope);
    const securityContext =
      await this.options.mfaVerificationRepository.findMfaVerificationSecurityContextByUserId(
        userId,
      );

    if (!securityContext) {
      throw new BadRequestError("User account could not be found.");
    }

    const availableFactors: MfaVerificationFactor[] = [];
    const activeTotpAvailable = securityContext.mfaTotp?.status === "active";

    if (securityContext.emailVerified) {
      availableFactors.push("email");
    }

    if (activeTotpAvailable) {
      availableFactors.push("totp");
    }

    const recommendedFactor: MfaVerificationFactor | null = activeTotpAvailable
      ? "totp"
      : securityContext.emailVerified
        ? "email"
        : null;

    return {
      securityContext,
      availableFactors,
      recommendedFactor,
      securityVersion: this.deriveSecurityVersion(securityContext),
      activeTotpAvailable,
    };
  }

  private assertSupportedScope(
    scope: string,
  ): asserts scope is MfaVerificationScope {
    if (scope !== MFA_MANAGEMENT_SCOPE && scope !== MFA_DEVICE_LOGIN_SCOPE) {
      throw new BadRequestError("Unsupported MFA verification scope.", {
        scope,
      });
    }
  }

  private requireUsableFactor(
    factorState: VerifiedFactorState,
    factor: MfaVerificationFactor,
  ): MfaVerificationChallengeFactor {
    if (factor === "sms") {
      throw new MfaFactorUnavailableError();
    }

    if (!factorState.availableFactors.includes(factor)) {
      throw new MfaFactorUnavailableError();
    }

    return factor;
  }

  private deriveSecurityVersion(
    context: MfaVerificationSecurityContext,
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          email: context.email,
          emailVerified: context.emailVerified,
          tokenVersion: context.tokenVersion,
          // Ignore mutable usage metadata (updatedAt, lastUsedCounter) so that
          // unrelated account writes don't silently invalidate a valid proof.
          // Security-relevant changes (email, emailVerified, tokenVersion) each
          // invalidate the proof via the fields above.
          activeTotp:
            context.mfaTotp?.status === "active"
              ? {
                  status: context.mfaTotp.status,
                  confirmedAt: context.mfaTotp.confirmedAt,
                }
              : null,
        }),
      )
      .digest("hex");
  }

  private async persistProof(input: {
    userId: string;
    sessionId: string;
    scope: MfaVerificationScope;
    factor: MfaVerificationChallengeFactor;
    factorState: VerifiedFactorState;
  }): Promise<MfaVerificationProofRecord> {
    const verifiedAt = new Date();
    const verifiedUntil = new Date(verifiedAt.getTime() + MFA_PROOF_TTL_MS);
    const ttlSeconds = Math.max(
      1,
      Math.ceil((verifiedUntil.getTime() - verifiedAt.getTime()) / 1000),
    );

    const proof: MfaVerificationProofRecord = {
      userId: input.userId,
      sessionId: input.sessionId,
      scope: input.scope,
      factor: input.factor,
      verifiedAt: verifiedAt.toISOString(),
      verifiedUntil: verifiedUntil.toISOString(),
      securityVersion: input.factorState.securityVersion,
    };

    await this.options.cache.setJson(
      this.getProofKey(input.sessionId, input.scope),
      proof,
      ttlSeconds,
    );

    return proof;
  }

  private buildBypassProof(input: {
    userId: string;
    sessionId: string;
    scope: MfaVerificationScope;
    factorState: VerifiedFactorState;
  }): MfaVerificationProofRecord {
    const factor =
      input.factorState.recommendedFactor === "totp" ? "totp" : "email";

    return {
      userId: input.userId,
      sessionId: input.sessionId,
      scope: input.scope,
      factor,
      verifiedAt: new Date().toISOString(),
      verifiedUntil: this.computeBypassVerifiedUntil(),
      securityVersion: input.factorState.securityVersion,
    };
  }

  private computeBypassVerifiedUntil(): string {
    return new Date(Date.now() + MFA_PROOF_TTL_MS).toISOString();
  }

  private async readProof(
    sessionId: string,
    scope: MfaVerificationScope,
  ): Promise<MfaVerificationProofRecord | null> {
    return this.options.cache.getJson<MfaVerificationProofRecord>(
      this.getProofKey(sessionId, scope),
    );
  }

  private async validateProof(input: {
    proof: MfaVerificationProofRecord | null;
    userId: string;
    sessionId: string;
    scope: MfaVerificationScope;
    factorState: VerifiedFactorState;
  }): Promise<MfaVerificationProofRecord | null> {
    if (!input.proof) {
      return null;
    }

    const expiresAtMs = Date.parse(input.proof.verifiedUntil);
    const isValid =
      input.proof.userId === input.userId &&
      input.proof.sessionId === input.sessionId &&
      input.proof.scope === input.scope &&
      Number.isFinite(expiresAtMs) &&
      Date.now() < expiresAtMs &&
      input.proof.securityVersion === input.factorState.securityVersion;

    if (isValid) {
      return input.proof;
    }

    await this.options.cache.delete(
      this.getProofKey(input.sessionId, input.scope),
    );
    return null;
  }

  private async consumeWindowRateLimit(input: {
    kind: "challenge" | "confirm";
    userId: string;
    sessionId: string;
    scope: MfaVerificationScope;
    factor: MfaVerificationChallengeFactor;
    limit: number;
    windowSeconds: number;
  }): Promise<void> {
    const key = this.getRateLimitKey(
      input.kind,
      input.userId,
      input.sessionId,
      input.scope,
      input.factor,
    );
    const now = Date.now();
    const record =
      (await this.options.cache.getJson<{ count: number; resetAt: number }>(
        key,
      )) ?? null;

    if (record && record.resetAt > now && record.count >= input.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((record.resetAt - now) / 1000),
      );
      if (input.kind === "challenge") {
        throw new MfaChallengeRateLimitedError(undefined, {
          retryAfterSeconds,
        });
      }

      throw new MfaConfirmRateLimitedError(undefined, {
        retryAfterSeconds,
      });
    }

    const nextRecord =
      !record || record.resetAt <= now
        ? {
            count: 1,
            resetAt: now + input.windowSeconds * 1000,
          }
        : {
            count: record.count + 1,
            resetAt: record.resetAt,
          };

    await this.options.cache.setJson(key, nextRecord, input.windowSeconds);
  }

  private async assertConfirmLockNotActive(
    input: Pick<VerificationRequestContext, "userId" | "sessionId" | "scope">,
    factor: MfaVerificationChallengeFactor,
  ): Promise<void> {
    const key = this.getConfirmLockKey(
      input.userId,
      input.sessionId,
      input.scope,
      factor,
    );
    const ttl = await this.options.cache.ttl(key);

    if (ttl > 0) {
      throw new MfaConfirmRateLimitedError(undefined, {
        retryAfterSeconds: ttl,
      });
    }
  }

  private async recordFailedConfirmAttempt(
    input: Pick<VerificationRequestContext, "userId" | "sessionId" | "scope">,
    factor: MfaVerificationChallengeFactor,
  ): Promise<void> {
    const key = this.getFailedConfirmKey(
      input.userId,
      input.sessionId,
      input.scope,
      factor,
    );
    const existing = (await this.options.cache.getJson<{ count: number }>(
      key,
    )) ?? { count: 0 };
    const nextCount = existing.count + 1;

    await this.options.cache.setJson(
      key,
      { count: nextCount },
      FAILED_CONFIRM_TTL_SECONDS,
    );

    if (nextCount >= FAILED_CONFIRM_THRESHOLD) {
      await this.options.cache.set(
        this.getConfirmLockKey(
          input.userId,
          input.sessionId,
          input.scope,
          factor,
        ),
        "1",
        FAILED_CONFIRM_LOCK_SECONDS,
      );
      throw new MfaConfirmRateLimitedError(undefined, {
        retryAfterSeconds: FAILED_CONFIRM_LOCK_SECONDS,
      });
    }
  }

  private async clearConfirmAttemptState(
    input: Pick<VerificationRequestContext, "userId" | "sessionId" | "scope">,
    factor: MfaVerificationChallengeFactor,
  ): Promise<void> {
    await this.options.cache.deleteMany([
      this.getFailedConfirmKey(
        input.userId,
        input.sessionId,
        input.scope,
        factor,
      ),
      this.getConfirmLockKey(
        input.userId,
        input.sessionId,
        input.scope,
        factor,
      ),
      this.getRateLimitKey(
        "confirm",
        input.userId,
        input.sessionId,
        input.scope,
        factor,
      ),
    ]);
  }

  private getProofKey(sessionId: string, scope: MfaVerificationScope): string {
    return `auth:mfa-proof:${sessionId}:${scope}`;
  }

  private getOtpSubject(
    userId: string,
    sessionId: string,
    scope: MfaVerificationScope,
    factor: MfaVerificationChallengeFactor,
  ): string {
    return `${userId}:${sessionId}:${scope}:${factor}`;
  }

  private getRateLimitKey(
    kind: "challenge" | "confirm",
    userId: string,
    sessionId: string,
    scope: MfaVerificationScope,
    factor: MfaVerificationChallengeFactor,
  ): string {
    return `auth:mfa-verify:${kind}:${userId}:${sessionId}:${scope}:${factor}`;
  }

  private getFailedConfirmKey(
    userId: string,
    sessionId: string,
    scope: MfaVerificationScope,
    factor: MfaVerificationChallengeFactor,
  ): string {
    return `auth:mfa-verify:failures:${userId}:${sessionId}:${scope}:${factor}`;
  }

  private getConfirmLockKey(
    userId: string,
    sessionId: string,
    scope: MfaVerificationScope,
    factor: MfaVerificationChallengeFactor,
  ): string {
    return `auth:mfa-verify:lock:${userId}:${sessionId}:${scope}:${factor}`;
  }

  private logSecurityEvent(
    message: string,
    input: VerificationRequestContext & {
      factor?: MfaVerificationFactor;
      client?: ClientRequestContext;
      result: string;
    },
  ): void {
    this.logger.info(message, {
      userId: input.userId,
      sessionId: input.sessionId,
      scope: input.scope,
      factor: input.factor,
      result: input.result,
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
