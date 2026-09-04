import BadRequestError from "@/errors/http/bad-request.error";
import InvalidMfaCodeError from "@/errors/http/invalid-mfa-code.error";
import MfaChallengeRateLimitedError from "@/errors/http/mfa-challenge-rate-limited.error";
import MfaVerificationRequiredError from "@/errors/http/mfa-verification-required.error";
import TooManyRequestError from "@/errors/http/too-many-request.error";
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

  const service = new MfaVerificationService({
    mfaVerificationRepository: authRepository as any,
    cache: cache.service as any,
    otpService: otpService as any,
    emailService: emailService as any,
    mfaTotpService: mfaTotpService as any,
  });

  return {
    service,
    cache,
    authRepository,
    otpService,
    emailService,
    mfaTotpService,
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
      client: { device: { type: "desktop", isMobile: false } },
    });

    expect(otpService.issue).toHaveBeenCalledWith({
      purpose: "mfa-step-up",
      subject: `${USER_1_ID}:session-1:device-login:email`,
    });
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
      availableFactors: ["email", "totp"],
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
      availableFactors: ["email", "totp"],
      recommendedFactor: "totp",
    });
  });

  it("scopes email OTP challenges to user, session, scope, and factor", async () => {
    const { service, otpService } = createService();

    await service.issueChallenge({
      userId: USER_1_ID,
      sessionId: "session-1",
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "email",
      client: { device: { type: "desktop", isMobile: false } },
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
      client: { device: { type: "desktop", isMobile: false } },
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
        client: { device: { type: "desktop", isMobile: false } },
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
      client: { device: { type: "desktop", isMobile: false } },
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
      client: { device: { type: "desktop", isMobile: false } },
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
      client: { device: { type: "desktop", isMobile: false } },
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
      client: { device: { type: "desktop", isMobile: false } },
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
    const { service, otpService } = createService();
    otpService.issue.mockRejectedValue(
      new TooManyRequestError("cooldown", { retryAfterSeconds: 42 }),
    );

    await expect(
      service.issueChallenge({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
        factor: "email",
        client: { device: { type: "desktop", isMobile: false } },
      }),
    ).rejects.toMatchObject<Partial<MfaChallengeRateLimitedError>>({
      code: "MFA_CHALLENGE_RATE_LIMITED",
      details: { retryAfterSeconds: 42 },
    });
  });

  it("returns the stable invalid-code error for failed verification attempts", async () => {
    const { service, otpService } = createService();
    otpService.verify.mockRejectedValue(new BadRequestError("invalid"));

    await expect(
      service.confirmChallenge({
        userId: USER_1_ID,
        sessionId: "session-1",
        scope: MFA_MANAGEMENT_SCOPE,
        factor: "email",
        code: "000000",
        client: { device: { type: "desktop", isMobile: false } },
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);
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
        client: { device: { type: "desktop", isMobile: false } },
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
