import { environment } from "@/configuration/environment";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { requireLoginMfa } from "@/features/auth/mfa/login-mfa.guard";

function createMfaTotpService(overrides: Partial<MfaTotpService> = {}) {
  return {
    isEnabled: jest.fn().mockResolvedValue(false),
    verifyCode: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MfaTotpService;
}

describe("requireLoginMfa", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("passes when the account has no authenticator enrolled", async () => {
    const mfaTotpService = createMfaTotpService();

    await expect(
      requireLoginMfa(mfaTotpService, "user-1", "user@example.com", undefined),
    ).resolves.toBeUndefined();
    expect(mfaTotpService.verifyCode).not.toHaveBeenCalled();
  });

  it("demands a code once an authenticator is enrolled", async () => {
    const mfaTotpService = createMfaTotpService({
      isEnabled: jest.fn().mockResolvedValue(true),
    } as Partial<MfaTotpService>);

    await expect(
      requireLoginMfa(mfaTotpService, "user-1", "user@example.com", undefined),
    ).rejects.toMatchObject({
      constructor: UnauthorizedError,
      details: { mfaRequired: true },
    });
  });

  it("verifies the supplied code", async () => {
    const mfaTotpService = createMfaTotpService({
      isEnabled: jest.fn().mockResolvedValue(true),
    } as Partial<MfaTotpService>);

    await expect(
      requireLoginMfa(mfaTotpService, "user-1", "user@example.com", "123456"),
    ).resolves.toBeUndefined();
    expect(mfaTotpService.verifyCode).toHaveBeenCalledWith("user-1", "123456");
  });

  it("skips the check entirely for a bypass-eligible address", async () => {
    // The bypass allowlist is empty by default in the test environment, so put an
    // address on it to reach the branch.
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      mfaBypassEmails: ["bypass@rentify.local"],
    });
    const mfaTotpService = createMfaTotpService({
      isEnabled: jest.fn().mockResolvedValue(true),
    } as Partial<MfaTotpService>);

    await expect(
      requireLoginMfa(mfaTotpService, "user-1", "bypass@rentify.local", undefined),
    ).resolves.toBeUndefined();
    expect(mfaTotpService.isEnabled).not.toHaveBeenCalled();
  });
});
