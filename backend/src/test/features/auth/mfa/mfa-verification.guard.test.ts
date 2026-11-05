import type { Request } from "express";
import MfaVerificationRequiredError from "@/errors/http/mfa-verification-required.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import {
  requireRecentMfaVerification,
  requireRecentMfaVerificationForAnyScope,
} from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 410001);
const auth = { sub: USER_ID, sessionId: "session-1", authMethod: "jwt" };

const mockRequireSessionAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

function createService(
  assertRecentVerification: jest.Mock = jest.fn(async () => undefined),
) {
  return {
    service: { assertRecentVerification } as unknown as MfaVerificationService,
    assertRecentVerification,
  };
}

const request = { client: { ip: "127.0.0.1" } } as unknown as Request;

beforeEach(() => {
  mockRequireSessionAuth.mockReset();
  mockRequireSessionAuth.mockResolvedValue(auth);
});

describe("requireRecentMfaVerification", () => {
  it("returns the session once its proof checks out", async () => {
    const { service, assertRecentVerification } = createService();

    await expect(
      requireRecentMfaVerification(request, service, "mfa-management"),
    ).resolves.toBe(auth);

    expect(assertRecentVerification).toHaveBeenCalledWith({
      userId: USER_ID,
      sessionId: "session-1",
      scope: "mfa-management",
      client: request.client,
    });
  });

  it("refuses a principal with no session", async () => {
    mockRequireSessionAuth.mockResolvedValue({ ...auth, sessionId: undefined });
    const { service, assertRecentVerification } = createService();

    await expect(
      requireRecentMfaVerification(request, service, "mfa-management"),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(assertRecentVerification).not.toHaveBeenCalled();
  });
});

describe("requireRecentMfaVerificationForAnyScope", () => {
  const scopes = ["device-login", "mfa-management"] as const;

  it("stops at the first scope with a proof", async () => {
    const { service, assertRecentVerification } = createService();

    await requireRecentMfaVerificationForAnyScope(request, service, scopes);

    expect(assertRecentVerification).toHaveBeenCalledTimes(1);
    expect(assertRecentVerification).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "device-login" }),
    );
  });

  it("accepts a proof from a later scope", async () => {
    const { service, assertRecentVerification } = createService(
      jest
        .fn()
        .mockRejectedValueOnce(
          new MfaVerificationRequiredError({ scope: "device-login" }),
        )
        .mockResolvedValueOnce(undefined),
    );

    await expect(
      requireRecentMfaVerificationForAnyScope(request, service, scopes),
    ).resolves.toBe(auth);

    expect(assertRecentVerification).toHaveBeenCalledTimes(2);
  });

  it("reports the last scope when no proof exists", async () => {
    const { service } = createService(
      jest.fn(async ({ scope }: { scope: string }) => {
        throw new MfaVerificationRequiredError({ scope });
      }),
    );

    await expect(
      requireRecentMfaVerificationForAnyScope(request, service, scopes),
    ).rejects.toMatchObject({
      code: "MFA_VERIFICATION_REQUIRED",
      details: { scope: "mfa-management" },
    });
  });

  it("does not treat an unrelated failure as a missing proof", async () => {
    const failure = new Error("redis unavailable");
    const { service, assertRecentVerification } = createService(
      jest.fn().mockRejectedValue(failure),
    );

    await expect(
      requireRecentMfaVerificationForAnyScope(request, service, scopes),
    ).rejects.toBe(failure);

    expect(assertRecentVerification).toHaveBeenCalledTimes(1);
  });
});
