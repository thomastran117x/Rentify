import AccountSuspendedError from "@/errors/http/account-suspended.error";
import LockedError from "@/errors/http/locked.error";
import {
  assertAccountIsActive,
  SECURITY_HOLD_DETAILS,
  toBlockedAccountReasonCode,
} from "@/features/auth/account-status/account-status.guard";
import { normalizeAccountStatus } from "@/features/auth/auth.model";

describe("assertAccountIsActive", () => {
  it("lets an active account through", () => {
    expect(() => assertAccountIsActive({ status: "active" })).not.toThrow();
  });

  it("refuses a locked account with a security-hold 423", () => {
    expect(() => assertAccountIsActive({ status: "locked" })).toThrow(
      expect.objectContaining({
        constructor: LockedError,
        status: 423,
        code: "ACCOUNT_LOCKED",
        details: SECURITY_HOLD_DETAILS,
      }),
    );
  });

  it("refuses a suspended account with a 403", () => {
    expect(() => assertAccountIsActive({ status: "suspended" })).toThrow(
      AccountSuspendedError,
    );
    expect(() => assertAccountIsActive({ status: "suspended" })).toThrow(
      expect.objectContaining({ status: 403, code: "ACCOUNT_SUSPENDED" }),
    );
  });
});

describe("toBlockedAccountReasonCode", () => {
  it("maps each blocked status to its audit reason", () => {
    expect(toBlockedAccountReasonCode("locked")).toBe("account_locked");
    expect(toBlockedAccountReasonCode("suspended")).toBe("account_suspended");
  });
});

describe("normalizeAccountStatus", () => {
  it("keeps a known status and treats a missing one as active", () => {
    expect(normalizeAccountStatus("locked")).toBe("locked");
    expect(normalizeAccountStatus(null)).toBe("active");
  });

  it("fails closed on an unrecognised value", () => {
    expect(normalizeAccountStatus("disabled")).toBe("suspended");
  });
});
