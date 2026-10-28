import { environment } from "@/configuration/environment";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { evaluateLoginMfa } from "@/features/auth/mfa/login-mfa.guard";
import { testUuid } from "../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

function createMfaTotpService(overrides: Partial<MfaTotpService> = {}) {
  return {
    isEnabled: jest.fn().mockResolvedValue(false),
    verifyCode: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MfaTotpService;
}

describe("evaluateLoginMfa", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("passes when the account has no authenticator enrolled", async () => {
    const mfaTotpService = createMfaTotpService();

    await expect(
      evaluateLoginMfa(
        mfaTotpService,
        USER_1_ID,
        "user@example.com",
        undefined,
      ),
    ).resolves.toBe("satisfied");
    expect(mfaTotpService.verifyCode).not.toHaveBeenCalled();
  });

  it("asks for a challenge once an authenticator is enrolled", async () => {
    const mfaTotpService = createMfaTotpService({
      isEnabled: jest.fn().mockResolvedValue(true),
    } as Partial<MfaTotpService>);

    await expect(
      evaluateLoginMfa(
        mfaTotpService,
        USER_1_ID,
        "user@example.com",
        undefined,
      ),
    ).resolves.toBe("challenge");
    expect(mfaTotpService.verifyCode).not.toHaveBeenCalled();
  });

  it("verifies the supplied code", async () => {
    const mfaTotpService = createMfaTotpService({
      isEnabled: jest.fn().mockResolvedValue(true),
    } as Partial<MfaTotpService>);

    await expect(
      evaluateLoginMfa(mfaTotpService, USER_1_ID, "user@example.com", "123456"),
    ).resolves.toBe("satisfied");
    expect(mfaTotpService.verifyCode).toHaveBeenCalledWith(USER_1_ID, "123456");
  });

  it("rejects a wrong supplied code", async () => {
    const mfaTotpService = createMfaTotpService({
      isEnabled: jest.fn().mockResolvedValue(true),
      verifyCode: jest
        .fn()
        .mockRejectedValue(new UnauthorizedError("MFA verification failed.")),
    } as Partial<MfaTotpService>);

    await expect(
      evaluateLoginMfa(mfaTotpService, USER_1_ID, "user@example.com", "000000"),
    ).rejects.toBeInstanceOf(UnauthorizedError);
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
      evaluateLoginMfa(
        mfaTotpService,
        USER_1_ID,
        "bypass@rentify.local",
        undefined,
      ),
    ).resolves.toBe("satisfied");
    expect(mfaTotpService.isEnabled).not.toHaveBeenCalled();
  });
});
