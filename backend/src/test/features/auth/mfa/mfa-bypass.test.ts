import { environment } from "@/configuration/environment";
import { isMfaBypassEligible } from "@/features/auth/mfa/mfa-bypass";

describe("isMfaBypassEligible", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockNonProduction(bypassEmails: string[] = []) {
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      mfaBypassEmails: bypassEmails,
    });
  }

  it("returns false for null email", () => {
    expect(isMfaBypassEligible(null)).toBe(false);
  });

  it("returns false for undefined email", () => {
    expect(isMfaBypassEligible(undefined)).toBe(false);
  });

  it("returns false when running in production regardless of email", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    expect(isMfaBypassEligible("admin@rentify.local")).toBe(false);
  });

  it("returns false for a whitespace-only email (normalized to empty string)", () => {
    mockNonProduction(["admin@rentify.local"]);
    // After trim().toLowerCase(), the email becomes "" → falsy → early return false
    expect(isMfaBypassEligible("   ")).toBe(false);
  });

  it("returns true when the email is in the bypass allowlist", () => {
    mockNonProduction(["admin@rentify.local"]);
    expect(isMfaBypassEligible("admin@rentify.local")).toBe(true);
  });

  it("returns false when the email is not in the bypass allowlist", () => {
    mockNonProduction(["admin@rentify.local"]);
    expect(isMfaBypassEligible("other@rentify.local")).toBe(false);
  });
});
