import type { AuthSecurityStepUpConfig } from "@/configuration/environment/types";
import BadRequestError from "@/errors/http/bad-request.error";
import InvalidMfaCodeError from "@/errors/http/invalid-mfa-code.error";
import MfaChallengeRateLimitedError from "@/errors/http/mfa-challenge-rate-limited.error";
import MfaConfirmRateLimitedError from "@/errors/http/mfa-confirm-rate-limited.error";
import MfaFactorUnavailableError from "@/errors/http/mfa-factor-unavailable.error";
import MfaVerificationRequiredError from "@/errors/http/mfa-verification-required.error";
import TooManyRequestError from "@/errors/http/too-many-request.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { environment } from "@/configuration/environment";
import { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import {
  MFA_DEVICE_LOGIN_SCOPE,
  MFA_MANAGEMENT_SCOPE,
} from "@/features/auth/mfa/verification/mfa-verification.model";
import { testUuid } from "../../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

function createSecurityContext(
  overrides: Partial<{
    emailVerified: boolean;
    tokenVersion: number;
    updatedAt: string;
    firstName?: string;
    email?: string;
    mfaTotp: {
      status: string;
      updatedAt: string;
      confirmedAt?: string;
    } | null;
    unusedRecoveryCodes: number;
  }> = {},
) {
  return {
    id: USER_1_ID,
    email: "user@example.com",
    firstName: "Test",
    emailVerified: true,
    tokenVersion: 1,
    updatedAt: "2026-06-27T15:00:00.000Z",
    mfaTotp: null,
    unusedRecoveryCodes: 0,
    ...overrides,
  };
}

function createCache() {
  const jsonStore = new Map<string, { value: unknown; ttlSeconds: number }>();
  const valueStore = new Map<string, { value: string; ttlSeconds: number }>();

  return {
    jsonStore,
    valueStore,
    service: {
      getJson: jest.fn(async <TValue>(key: string) => {
        return (jsonStore.get(key)?.value as TValue | undefined) ?? null;
      }),
      setJson: jest.fn(
        async (key: string, value: unknown, ttlSeconds: number) => {
          jsonStore.set(key, { value, ttlSeconds });
        },
      ),
      set: jest.fn(async (key: string, value: string, ttlSeconds: number) => {
        valueStore.set(key, { value, ttlSeconds });
      }),
      ttl: jest.fn(async (key: string) => {
        return (
          jsonStore.get(key)?.ttlSeconds ??
          valueStore.get(key)?.ttlSeconds ??
          -1
        );
      }),
      delete: jest.fn(async (key: string) => {
        const deletedJson = jsonStore.delete(key);
        const deletedValue = valueStore.delete(key);
        return deletedJson || deletedValue;
      }),
      deleteMany: jest.fn(async (keys: string[]) => {
        let deleted = 0;
        for (const key of keys) {
          if (jsonStore.delete(key) || valueStore.delete(key)) {
            deleted += 1;
          }
        }
        return deleted;
      }),
    },
  };
}

function createService(
  overrides: Partial<{
    securityContext: ReturnType<typeof createSecurityContext>;
    limits: AuthSecurityStepUpConfig;
  }> = {},
) {
  const cache = createCache();
  const authRepository = {
    findMfaVerificationSecurityContextByUserId: jest.fn(
      async () => overrides.securityContext ?? createSecurityContext(),
    ),
  };
  const otpService = {
    issue: jest.fn(async () => ({
      code: "123456",
      ttlInSeconds: 600,
      resendAvailableInSeconds: 60,
    })),
    verify: jest.fn(async () => undefined),
    peek: jest.fn(async () => ({
      code: "123456",
      expiresInSeconds: 300,
    })),
  };
  const emailService = {
    sendMfaStepUpEmail: jest.fn(async () => undefined),
  };
  const mfaTotpService = {
    verifyCode: jest.fn(async () => undefined),
  };
  const mfaRecoveryCodeService = {
    redeem: jest.fn(async () => 3),
  };
  const authAuditService = {
    recordSafely: jest.fn(async (_input: Record<string, unknown>) => undefined),
  };

  const service = new MfaVerificationService({
    mfaVerificationRepository: authRepository as any,
    cache: cache.service as any,
    otpService: otpService as any,
    emailService: emailService as any,
    mfaTotpService: mfaTotpService as any,
    mfaRecoveryCodeService: mfaRecoveryCodeService as any,
    authAuditService: authAuditService as any,
    getLimits: overrides.limits ? () => overrides.limits! : undefined,
  });

  return {
    service,
    cache,
    authRepository,
    otpService,
    emailService,
    mfaTotpService,
    mfaRecoveryCodeService,
    authAuditService,
  };
}

describe("MfaVerificationService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns an empty-factor options contract when no step-up factors are usable", async () => {
    const { service } = createService({
      securityContext: createSecurityContext({
        emailVerified: false,
        mfaTotp: null,
      }),
    });

    await expect(
      service.getOptions({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
      }),
    ).resolves.toEqual({
      scope: MFA_MANAGEMENT_SCOPE,
      verified: false,
      verifiedUntil: null,
      availableFactors: [],
      recommendedFactor: null,
    });
  });
  it("supports device-login as a first-class verification scope", async () => {
    const { service, otpService } = createService();

    await expect(
      service.getOptions({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_DEVICE_LOGIN_SCOPE,
      }),
    ).resolves.toMatchObject({
      scope: MFA_DEVICE_LOGIN_SCOPE,
      availableFactors: ["email"],
      recommendedFactor: "email",
    });

    await service.issueChallenge({
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_DEVICE_LOGIN_SCOPE,
      factor: "email",
      client: {
        source: "frontend-browser",
        device: { type: "desktop" as const, isMobile: false },
      },
    });

    expect(otpService.issue).toHaveBeenCalledWith({
      purpose: "mfa-step-up",
      subject: `${USER_1_ID}:session-1:device-login:email`,
    });
  });

  it("records a completed sign-in's factor as the session's device-login proof", async () => {
    const { service, cache } = createService({
      securityContext: createSecurityContext({
        mfaTotp: {
          status: "active",
          updatedAt: "2026-06-27T15:00:00.000Z",
          confirmedAt: "2026-06-27T15:00:00.000Z",
        },
      }),
    });

    await service.recordLoginProof({
      userId: USER_1_ID,
      sessionId: "session-1",
      factor: "totp",
    });

    expect(cache.service.setJson).toHaveBeenCalledWith(
      "auth:mfa-proof:session-1:device-login",
      expect.objectContaining({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_DEVICE_LOGIN_SCOPE,
        factor: "totp",
      }),
      900,
    );
    await expect(
      service.getOptions({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_DEVICE_LOGIN_SCOPE,
      }),
    ).resolves.toMatchObject({ verified: true });
  });

  it("treats allowlisted users as already verified in getOptions", async () => {
    const { service } = createService({
      securityContext: createSecurityContext({
        email: "owner1@rentify.local",
        mfaTotp: {
          status: "active",
          updatedAt: "2026-06-27T15:20:00.000Z",
          confirmedAt: "2026-06-27T15:10:00.000Z",
        },
      }),
    });
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      mfaBypassEmails: ["owner1@rentify.local"],
    });

    const options = await service.getOptions({
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
    });

    expect(options).toMatchObject({
      scope: MFA_MANAGEMENT_SCOPE,
      verified: true,
      availableFactors: ["totp"],
      recommendedFactor: "totp",
    });
    expect(options.verifiedUntil).not.toBeNull();
    expect(Date.parse(options.verifiedUntil as string)).toBeGreaterThan(
      Date.now(),
    );
  });

  it("recommends totp when an active authenticator factor exists", async () => {
    const { service } = createService({
      securityContext: createSecurityContext({
        mfaTotp: {
          status: "active",
          updatedAt: "2026-06-27T15:20:00.000Z",
          confirmedAt: "2026-06-27T15:10:00.000Z",
        },
      }),
    });

    await expect(
      service.getOptions({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
      }),
    ).resolves.toMatchObject({
      availableFactors: ["totp"],
      recommendedFactor: "totp",
    });
  });

  describe("with a stronger factor active", () => {
    const client = {
      source: "frontend-browser" as const,
      device: { type: "desktop" as const, isMobile: false },
    };
    const totpContext = (unusedRecoveryCodes = 0) =>
      createSecurityContext({
        mfaTotp: {
          status: "active",
          updatedAt: "2026-06-27T15:20:00.000Z",
          confirmedAt: "2026-06-27T15:10:00.000Z",
        },
        unusedRecoveryCodes,
      });

    describe("recovery codes", () => {
      const confirmRecoveryCode = (
        service: MfaVerificationService,
        scope: typeof MFA_MANAGEMENT_SCOPE | typeof MFA_DEVICE_LOGIN_SCOPE,
      ) =>
        service.confirmChallenge({
          userId: USER_1_ID,
          sessionId: "session-1",
          scope,
          factor: "recovery_code",
          code: "ABCDE-FGH23",
          client,
          audit: { requestId: "request-1" },
        });

      it("offers them after the authenticator while some are left", async () => {
        const { service } = createService({
          securityContext: totpContext(2),
        });

        await expect(
          service.getOptions({
            userId: USER_1_ID,
            sessionId: "session-1",
            scope: MFA_MANAGEMENT_SCOPE,
          }),
        ).resolves.toMatchObject({
          availableFactors: ["totp", "recovery_code"],
          recommendedFactor: "totp",
        });
      });

      it("falls back to nothing weaker once they run out", async () => {
        const { service } = createService({
          securityContext: totpContext(0),
        });

        await expect(
          service.getOptions({
            userId: USER_1_ID,
            sessionId: "session-1",
            scope: MFA_MANAGEMENT_SCOPE,
          }),
        ).resolves.toMatchObject({ availableFactors: ["totp"] });
        await expect(
          confirmRecoveryCode(service, MFA_MANAGEMENT_SCOPE),
        ).rejects.toBeInstanceOf(MfaFactorUnavailableError);
      });

      it("never offers them to an account without an authenticator", async () => {
        const { service } = createService({
          securityContext: createSecurityContext({ unusedRecoveryCodes: 4 }),
        });

        await expect(
          service.getOptions({
            userId: USER_1_ID,
            sessionId: "session-1",
            scope: MFA_MANAGEMENT_SCOPE,
          }),
        ).resolves.toMatchObject({ availableFactors: ["email"] });
      });

      it("prompts without sending anything", async () => {
        const { service, otpService } = createService({
          securityContext: totpContext(2),
        });

        await expect(
          service.issueChallenge({
            userId: USER_1_ID,
            sessionId: "session-1",
            scope: MFA_MANAGEMENT_SCOPE,
            factor: "recovery_code",
            client,
          }),
        ).resolves.toEqual({
          scope: MFA_MANAGEMENT_SCOPE,
          factor: "recovery_code",
          challengeId: null,
          prompt: true,
        });
        expect(otpService.issue).not.toHaveBeenCalled();
      });

      it("spends the code and records a proof", async () => {
        const { service, mfaRecoveryCodeService, mfaTotpService } =
          createService({ securityContext: totpContext(2) });

        await expect(
          confirmRecoveryCode(service, MFA_MANAGEMENT_SCOPE),
        ).resolves.toMatchObject({
          verified: true,
          factor: "recovery_code",
        });

        expect(mfaRecoveryCodeService.redeem).toHaveBeenCalledWith({
          userId: USER_1_ID,
          code: "ABCDE-FGH23",
          stage: "step_up",
          sessionId: "session-1",
          context: { requestId: "request-1" },
        });
        expect(mfaTotpService.verifyCode).not.toHaveBeenCalled();
      });

      it("treats a wrong code like any other, towards the session's lock", async () => {
        const { service, mfaRecoveryCodeService, authAuditService } =
          createService({ securityContext: totpContext(2) });
        mfaRecoveryCodeService.redeem.mockRejectedValue(
          new UnauthorizedError("MFA verification failed."),
        );

        await expect(
          confirmRecoveryCode(service, MFA_MANAGEMENT_SCOPE),
        ).rejects.toBeInstanceOf(InvalidMfaCodeError);

        expect(authAuditService.recordSafely).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: "mfa.step_up_failed",
            metadata: expect.objectContaining({ factor: "recovery_code" }),
          }),
        );
      });

      it.each([MFA_MANAGEMENT_SCOPE, MFA_DEVICE_LOGIN_SCOPE])(
        "keeps a %s proof made with the very last code",
        async (scope) => {
          const { service, authRepository } = createService({
            securityContext: totpContext(1),
          });

          await confirmRecoveryCode(service, scope);
          // The code that earned the proof was the last one.
          authRepository.findMfaVerificationSecurityContextByUserId.mockResolvedValue(
            totpContext(0),
          );

          await expect(
            service.assertRecentVerification({
              userId: USER_1_ID,
              sessionId: "session-1",
              scope,
            }),
          ).resolves.toMatchObject({ factor: "recovery_code" });
        },
      );

      it("keeps a device-login proof recorded by a sign-in with the last code", async () => {
        const { service } = createService({
          securityContext: totpContext(0),
        });

        await service.recordLoginProof({
          userId: USER_1_ID,
          sessionId: "session-1",
          factor: "recovery_code",
        });

        await expect(
          service.getOptions({
            userId: USER_1_ID,
            sessionId: "session-1",
            scope: MFA_DEVICE_LOGIN_SCOPE,
          }),
        ).resolves.toMatchObject({ verified: true });
      });

      it("does not let a spent code void another proof", async () => {
        const { service, authRepository } = createService({
          securityContext: totpContext(5),
        });

        await confirmRecoveryCode(service, MFA_MANAGEMENT_SCOPE);
        authRepository.findMfaVerificationSecurityContextByUserId.mockResolvedValue(
          totpContext(4),
        );

        await expect(
          service.assertRecentVerification({
            userId: USER_1_ID,
            sessionId: "session-1",
            scope: MFA_MANAGEMENT_SCOPE,
          }),
        ).resolves.toMatchObject({ factor: "recovery_code" });
      });

      it("does not keep the proof once the authenticator is gone", async () => {
        const { service, authRepository } = createService({
          securityContext: totpContext(2),
        });

        await confirmRecoveryCode(service, MFA_MANAGEMENT_SCOPE);
        authRepository.findMfaVerificationSecurityContextByUserId.mockResolvedValue(
          createSecurityContext(),
        );

        await expect(
          service.assertRecentVerification({
            userId: USER_1_ID,
            sessionId: "session-1",
            scope: MFA_MANAGEMENT_SCOPE,
          }),
        ).rejects.toBeInstanceOf(MfaVerificationRequiredError);
      });
    });

    it.each([MFA_MANAGEMENT_SCOPE, MFA_DEVICE_LOGIN_SCOPE])(
      "refuses an email challenge in the %s scope",
      async (scope) => {
        const { service, otpService } = createService({
          securityContext: totpContext(),
        });

        await expect(
          service.issueChallenge({
            userId: USER_1_ID,
            sessionId: "session-1",
            scope,
            factor: "email",
            client,
          }),
        ).rejects.toBeInstanceOf(MfaFactorUnavailableError);
        expect(otpService.issue).not.toHaveBeenCalled();
      },
    );

    it("refuses to confirm an email code", async () => {
      const { service, otpService } = createService({
        securityContext: totpContext(),
      });

      await expect(
        service.confirmChallenge({
          userId: USER_1_ID,
          sessionId: "session-1",
          scope: MFA_MANAGEMENT_SCOPE,
          factor: "email",
          code: "123456",
          client,
        }),
      ).rejects.toBeInstanceOf(MfaFactorUnavailableError);
      expect(otpService.verify).not.toHaveBeenCalled();
    });

    it("does not honour an email proof issued before the rule applied", async () => {
      const { service, cache } = createService({
        securityContext: totpContext(),
      });

      // Same security version as the account's, so only the factor check can
      // refuse it.
      await service.recordLoginProof({
        userId: USER_1_ID,
        sessionId: "session-1",
        factor: "email",
      });

      await expect(
        service.assertRecentVerification({
          userId: USER_1_ID,
          sessionId: "session-1",
          scope: MFA_DEVICE_LOGIN_SCOPE,
        }),
      ).rejects.toBeInstanceOf(MfaVerificationRequiredError);
      expect(cache.service.delete).toHaveBeenCalledWith(
        "auth:mfa-proof:session-1:device-login",
      );
    });

    it("offers the authenticator when the email is unverified", async () => {
      const context = totpContext();
      const { service } = createService({
        securityContext: { ...context, emailVerified: false },
      });

      await expect(
        service.getOptions({
          userId: USER_1_ID,
          sessionId: "session-1",
          scope: MFA_MANAGEMENT_SCOPE,
        }),
      ).resolves.toMatchObject({
        availableFactors: ["totp"],
        recommendedFactor: "totp",
      });
    });
  });

  it("scopes email OTP challenges to user, session, scope, and factor", async () => {
    const { service, otpService } = createService();

    await service.issueChallenge({
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "email",
      client: {
        source: "frontend-browser",
        device: { type: "desktop" as const, isMobile: false },
      },
    });

    expect(otpService.issue).toHaveBeenCalledWith({
      purpose: "mfa-step-up",
      subject: `${USER_1_ID}:session-1:mfa-management:email`,
    });
  });

  it("creates a fixed-lifetime proof and reuses it without sliding the ttl", async () => {
    const { service, cache, otpService } = createService();

    const confirmed = await service.confirmChallenge({
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "email",
      code: "123456",
      client: {
        source: "frontend-browser",
        device: { type: "desktop", isMobile: false },
      },
    });

    expect(confirmed.verified).toBe(true);
    expect(cache.service.setJson).toHaveBeenCalledWith(
      "auth:mfa-proof:session-1:mfa-management",
      expect.objectContaining({
        userId: USER_1_ID,
        sessionId: "session-1",
        factor: "email",
      }),
      900,
    );

    await expect(
      service.assertRecentVerification({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
      }),
    ).resolves.toMatchObject({
      verifiedUntil: confirmed.verifiedUntil,
    });
    expect(otpService.verify).toHaveBeenCalledTimes(1);
  });

  it("fails closed when proof persistence fails", async () => {
    const { service, cache } = createService();
    cache.service.setJson
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error("cache write failed"));

    await expect(
      service.confirmChallenge({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
        factor: "email",
        code: "123456",
        client: {
          source: "frontend-browser",
          device: { type: "desktop", isMobile: false },
        },
      }),
    ).rejects.toThrow("cache write failed");
  });

  it("clears confirm limiter state after a successful verification", async () => {
    const { service, cache } = createService();
    cache.jsonStore.set(
      `auth:mfa-verify:confirm:${USER_1_ID}:session-1:mfa-management:email`,
      {
        value: {
          count: 3,
          resetAt: Date.now() + 60_000,
        },
        ttlSeconds: 60,
      },
    );
    cache.jsonStore.set(
      `auth:mfa-verify:failures:${USER_1_ID}:session-1:mfa-management:email`,
      {
        value: { count: 2 },
        ttlSeconds: 600,
      },
    );

    await service.confirmChallenge({
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "email",
      code: "123456",
      client: {
        source: "frontend-browser",
        device: { type: "desktop", isMobile: false },
      },
    });

    expect(
      cache.jsonStore.has(
        `auth:mfa-verify:confirm:${USER_1_ID}:session-1:mfa-management:email`,
      ),
    ).toBe(false);
    expect(
      cache.jsonStore.has(
        `auth:mfa-verify:failures:${USER_1_ID}:session-1:mfa-management:email`,
      ),
    ).toBe(false);
  });

  it("isolates proofs by session and scope", async () => {
    const { service } = createService();

    await service.confirmChallenge({
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "email",
      code: "123456",
      client: {
        source: "frontend-browser",
        device: { type: "desktop", isMobile: false },
      },
    });

    await expect(
      service.assertRecentVerification({
        userId: USER_1_ID,
        sessionId: "session-2",
        scope: MFA_MANAGEMENT_SCOPE,
      }),
    ).rejects.toBeInstanceOf(MfaVerificationRequiredError);
  });

  it("invalidates an existing proof when the security version changes", async () => {
    const securityContext = createSecurityContext();
    const { service, authRepository } = createService({ securityContext });

    await service.confirmChallenge({
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "email",
      code: "123456",
      client: {
        source: "frontend-browser",
        device: { type: "desktop", isMobile: false },
      },
    });

    authRepository.findMfaVerificationSecurityContextByUserId.mockResolvedValue(
      createSecurityContext({ tokenVersion: 2 }),
    );

    await expect(
      service.assertRecentVerification({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
      }),
    ).rejects.toBeInstanceOf(MfaVerificationRequiredError);
  });

  it("allows recent verification checks to pass for allowlisted users without stored proof", async () => {
    const { service } = createService({
      securityContext: createSecurityContext({
        email: "owner1@rentify.local",
      }),
    });
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      mfaBypassEmails: ["owner1@rentify.local"],
    });

    await expect(
      service.assertRecentVerification({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
      }),
    ).resolves.toMatchObject({
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "email",
    });
  });

  it("keeps a TOTP proof valid when only usage metadata changes", async () => {
    const securityContext = createSecurityContext({
      mfaTotp: {
        status: "active",
        updatedAt: "2026-06-27T15:20:00.000Z",
        confirmedAt: "2026-06-27T15:10:00.000Z",
      },
    });
    const { service, authRepository, mfaTotpService } = createService({
      securityContext,
    });

    await service.confirmChallenge({
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "totp",
      code: "123456",
      client: {
        source: "frontend-browser",
        device: { type: "desktop", isMobile: false },
      },
    });

    expect(mfaTotpService.verifyCode).toHaveBeenCalledWith(USER_1_ID, "123456");

    authRepository.findMfaVerificationSecurityContextByUserId.mockResolvedValue(
      createSecurityContext({
        mfaTotp: {
          status: "active",
          updatedAt: "2026-06-27T15:21:00.000Z",
          confirmedAt: "2026-06-27T15:10:00.000Z",
        },
      }),
    );

    await expect(
      service.assertRecentVerification({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
      }),
    ).resolves.toMatchObject({
      factor: "totp",
    });
  });

  it("maps OTP cooldowns to the stable challenge rate-limit error code", async () => {
    const { service, otpService, authAuditService } = createService();
    otpService.issue.mockRejectedValue(
      new TooManyRequestError("cooldown", { retryAfterSeconds: 42 }),
    );

    await expect(
      service.issueChallenge({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
        factor: "email",
        client: {
          source: "frontend-browser",
          device: { type: "desktop", isMobile: false },
        },
      }),
    ).rejects.toMatchObject<Partial<MfaChallengeRateLimitedError>>({
      code: "MFA_CHALLENGE_RATE_LIMITED",
      details: { retryAfterSeconds: 42 },
    });
    expect(authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mfa.step_up_locked",
        outcome: "blocked",
        reasonCode: "rate_limited",
        metadata: {
          stage: "challenge",
          scope: MFA_MANAGEMENT_SCOPE,
          factor: "email",
          result: "cooldown",
        },
      }),
    );
  });

  it("returns the stable invalid-code error for failed verification attempts", async () => {
    const { service, otpService, authAuditService } = createService();
    otpService.verify.mockRejectedValue(new BadRequestError("invalid"));

    await expect(
      service.confirmChallenge({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
        factor: "email",
        code: "000000",
        client: {
          source: "frontend-browser",
          device: { type: "desktop", isMobile: false },
        },
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);
    expect(authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mfa.step_up_failed",
        outcome: "failure",
        reasonCode: "mfa_invalid",
        metadata: {
          stage: "confirm",
          scope: MFA_MANAGEMENT_SCOPE,
          factor: "email",
          result: "invalid_code",
        },
      }),
    );
  });

  it("records challenge delivery failures without the OTP code", async () => {
    const { service, emailService, authAuditService } = createService();
    emailService.sendMfaStepUpEmail.mockRejectedValue(new Error("mail down"));

    await expect(
      service.issueChallenge({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
        factor: "email",
        client: {
          source: "frontend-browser",
          device: { type: "desktop", isMobile: false },
        },
      }),
    ).rejects.toThrow("mail down");

    expect(authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mfa.step_up_failed",
        reasonCode: undefined,
        metadata: {
          stage: "challenge",
          scope: MFA_MANAGEMENT_SCOPE,
          factor: "email",
          result: "delivery_error",
        },
      }),
    );
    expect(
      JSON.stringify(authAuditService.recordSafely.mock.calls),
    ).not.toContain("123456");
  });

  it.each([
    ["challenge", 5],
    ["confirm", 10],
  ] as const)("records the %s window lock", async (kind, count) => {
    const { service, cache, authAuditService } = createService();
    cache.jsonStore.set(
      `auth:mfa-verify:${kind}:${USER_1_ID}:session-1:${MFA_MANAGEMENT_SCOPE}:email`,
      { value: { count, resetAt: Date.now() + 60_000 }, ttlSeconds: 60 },
    );
    const common = {
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "email" as const,
      client: {
        source: "frontend-browser" as const,
        device: { type: "desktop" as const, isMobile: false },
      },
    };

    await expect(
      kind === "challenge"
        ? service.issueChallenge(common)
        : service.confirmChallenge({ ...common, code: "000000" }),
    ).rejects.toMatchObject({
      code:
        kind === "challenge"
          ? "MFA_CHALLENGE_RATE_LIMITED"
          : "MFA_CONFIRM_RATE_LIMITED",
    });

    expect(authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mfa.step_up_locked",
        metadata: expect.objectContaining({
          stage: kind,
          result: "window_limit",
        }),
      }),
    );
  });

  it("records the repeated-code lock and attempts made while locked", async () => {
    const { service, otpService, authAuditService } = createService();
    otpService.verify.mockRejectedValue(new BadRequestError("invalid"));
    const input = {
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "email" as const,
      code: "000000",
      client: {
        source: "frontend-browser" as const,
        device: { type: "desktop" as const, isMobile: false },
      },
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(service.confirmChallenge(input)).rejects.toBeInstanceOf(
        InvalidMfaCodeError,
      );
    }
    await expect(service.confirmChallenge(input)).rejects.toBeInstanceOf(
      MfaConfirmRateLimitedError,
    );
    await expect(service.confirmChallenge(input)).rejects.toBeInstanceOf(
      MfaConfirmRateLimitedError,
    );

    const lockedEvents = authAuditService.recordSafely.mock.calls.filter(
      ([event]) => event.eventType === "mfa.step_up_locked",
    );
    expect(lockedEvents).toHaveLength(2);
    expect(lockedEvents[0][0]).toEqual(
      expect.objectContaining({
        reasonCode: "rate_limited",
        metadata: expect.objectContaining({ result: "failed_code_lock" }),
      }),
    );
  });

  it("follows the configured step-up limits", async () => {
    const { service, otpService, cache } = createService({
      limits: {
        challengeLimit: 5,
        challengeWindowSeconds: 60,
        confirmLimit: 10,
        confirmWindowSeconds: 60,
        failedConfirmThreshold: 2,
        failedConfirmTtlSeconds: 120,
        failedConfirmLockSeconds: 45,
      },
    });
    otpService.verify.mockRejectedValue(new BadRequestError("invalid"));
    const input = {
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "email" as const,
      code: "000000",
      client: {
        source: "frontend-browser" as const,
        device: { type: "desktop" as const, isMobile: false },
      },
    };

    await expect(service.confirmChallenge(input)).rejects.toBeInstanceOf(
      InvalidMfaCodeError,
    );
    await expect(service.confirmChallenge(input)).rejects.toMatchObject({
      code: "MFA_CONFIRM_RATE_LIMITED",
      details: { retryAfterSeconds: 45 },
    });
    expect(
      [...cache.jsonStore.values()].map((entry) => entry.ttlSeconds),
    ).toContain(120);
  });

  it("returns a prompt contract for TOTP challenges when an active factor exists", async () => {
    const { service, otpService } = createService({
      securityContext: createSecurityContext({
        mfaTotp: {
          status: "active",
          updatedAt: "2026-06-27T15:20:00.000Z",
          confirmedAt: "2026-06-27T15:10:00.000Z",
        },
      }),
    });

    await expect(
      service.issueChallenge({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
        factor: "totp",
        client: {
          source: "frontend-browser",
          device: { type: "desktop", isMobile: false },
        },
      }),
    ).resolves.toEqual({
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "totp",
      challengeId: null,
      prompt: true,
    });
    expect(otpService.issue).not.toHaveBeenCalled();
  });

  it("fails preview when no active MFA email verification code exists", async () => {
    const { service, otpService } = createService();
    otpService.peek.mockResolvedValue(null as any);

    await expect(
      service.previewCurrentEmailOtp({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
      }),
    ).rejects.toThrow("No active MFA verification code is available.");
  });

  it("blocks the preview helper in production", async () => {
    const { service } = createService();
    jest.spyOn(environment, "isProduction").mockReturnValue(true);

    await expect(
      service.previewCurrentEmailOtp({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
      }),
    ).rejects.toThrow("OTP preview is unavailable.");
  });
});
