import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment";
import MfaVerificationRequiredError from "@/errors/http/mfa-verification-required.error";
import { MfaTotpController } from "@/features/auth/mfa/totp/mfa-totp.controller";
import { MfaVerificationController } from "@/features/auth/mfa/verification/mfa-verification.controller";
import { createJwtClaims, createRouteTestApp } from "../../../support/integration-app";

function jsonHeaders(token = "user-token") {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

describe("MFA verification routes integration", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createApp() {
    const mfaVerificationService = {
      getOptions: jest.fn(async () => ({
        scope: "mfa-management",
        verified: false,
        verifiedUntil: null,
        availableFactors: ["email", "totp"],
        recommendedFactor: "totp",
      })),
      issueChallenge: jest.fn(async () => ({
        scope: "mfa-management",
        factor: "email",
        challengeId: null,
        cooldownUntil: "2026-06-27T15:30:00.000Z",
      })),
      confirmChallenge: jest.fn(async () => ({
        verified: true,
        scope: "mfa-management",
        factor: "email",
        verifiedUntil: "2026-06-27T15:45:00.000Z",
      })),
      previewCurrentEmailOtp: jest.fn(async () => ({
        scope: "mfa-management",
        factor: "email",
        code: "123456",
        expiresInSeconds: 300,
      })),
      assertRecentVerification: jest.fn(async () => undefined),
    };

    const mfaTotpService = {
      isEnabled: jest.fn(async () => false),
      beginEnrollment: jest.fn(async () => ({ secret: "secret", uri: "otpauth://test" })),
      confirmEnrollment: jest.fn(async () => undefined),
      cancelEnrollment: jest.fn(async () => undefined),
      disable: jest.fn(async () => undefined),
    };

    const tokenService = {
      verifyAccessToken: jest.fn(async (token: string) => {
        if (token !== "user-token") {
          throw new Error("invalid token");
        }

        return createJwtClaims({
          sub: "user-1",
          email: "user@example.com",
          sessionId: "session-1",
        });
      }),
    };

    const registry = new Map<unknown, unknown>([
      [
        containerTokens.mfaVerificationController,
        new MfaVerificationController(mfaVerificationService as never),
      ],
      [
        containerTokens.mfaTotpController,
        new MfaTotpController(
          mfaTotpService as never,
          mfaVerificationService as never,
        ),
      ],
      [containerTokens.tokenService, tokenService],
    ]);

    return {
      app: createRouteTestApp(registry),
      mfaVerificationService,
      mfaTotpService,
    };
  }

  it("serves the verification options, challenge, confirm, and preview endpoints", async () => {
    const { app, mfaVerificationService } = createApp();

    const optionsResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/options?scope=mfa-management")}`,
      { headers: jsonHeaders() },
    );
    const challengeResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/challenge")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "email",
        }),
      },
    );
    const confirmResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/confirm")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "email",
          code: "123456",
        }),
      },
    );
    const previewResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/dev/otp?scope=mfa-management")}`,
      { headers: jsonHeaders() },
    );

    expect(optionsResponse.status).toBe(200);
    expect(challengeResponse.status).toBe(200);
    expect(confirmResponse.status).toBe(200);
    expect(previewResponse.status).toBe(200);
    expect(mfaVerificationService.getOptions).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      scope: "mfa-management",
    });
  });

  it("rejects unsupported challenge factors at the request boundary", async () => {
    const { app, mfaVerificationService } = createApp();

    const challengeResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/challenge")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "sms",
        }),
      },
    );

    expect(challengeResponse.status).toBe(400);
    expect(mfaVerificationService.issueChallenge).not.toHaveBeenCalled();
  });

  it("does not register the preview route in production", async () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    const { app, mfaVerificationService } = createApp();

    const previewResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/dev/otp?scope=mfa-management")}`,
      { headers: jsonHeaders() },
    );

    expect(previewResponse.status).toBe(404);
    expect(mfaVerificationService.previewCurrentEmailOtp).not.toHaveBeenCalled();
  });

  it("blocks protected totp routes before proof and allows them after proof", async () => {
    const { app, mfaVerificationService, mfaTotpService } = createApp();
    mfaVerificationService.assertRecentVerification.mockRejectedValueOnce(
      new MfaVerificationRequiredError({
        scope: "mfa-management",
        availableFactors: ["email"],
        recommendedFactor: "email",
        verifiedUntil: null,
      }),
    );

    const blockedBegin = await app.request(
      `http://rent.test${buildApiPath("/auth/mfa/totp/begin")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      },
    );

    expect(blockedBegin.status).toBe(401);
    await expect(blockedBegin.json()).resolves.toMatchObject({
      error: {
        code: "MFA_VERIFICATION_REQUIRED",
      },
    });

    const allowedDisable = await app.request(
      `http://rent.test${buildApiPath("/auth/mfa/totp/disable")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      },
    );

    expect(allowedDisable.status).toBe(200);
    expect(mfaTotpService.disable).toHaveBeenCalledWith("user-1");
  });
});
