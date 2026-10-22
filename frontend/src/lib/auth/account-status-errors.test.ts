import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  SECURITY_HOLD_MESSAGE,
  getAccountStatusBlock,
} from "@/lib/auth/account-status-errors";

function clientError(status: number, code: string, details?: unknown) {
  return new ApiClientError("Request failed.", {
    code,
    status,
    details,
    request: {
      method: "POST",
      path: "/auth/oauth/google",
      requestUrl: "http://localhost:8040/api/v1/auth/oauth/google",
    },
  });
}

describe("getAccountStatusBlock", () => {
  it("recognises a security hold by its details", () => {
    expect(
      getAccountStatusBlock(
        clientError(423, "ACCOUNT_LOCKED", {
          reason: "security_hold",
          recovery: "password_reset",
        }),
      ),
    ).toEqual({ kind: "security_hold", message: SECURITY_HOLD_MESSAGE });
  });

  it("recognises a suspension", () => {
    expect(
      getAccountStatusBlock(clientError(403, "ACCOUNT_SUSPENDED")),
    ).toEqual({ kind: "suspended", message: ACCOUNT_SUSPENDED_MESSAGE });
  });

  it("leaves the temporary lockout and other errors alone", () => {
    expect(
      getAccountStatusBlock(
        clientError(423, "ACCOUNT_LOCKED", { unlockRequired: true }),
      ),
    ).toBeNull();
    expect(getAccountStatusBlock(clientError(403, "FORBIDDEN"))).toBeNull();
    expect(getAccountStatusBlock(new Error("offline"))).toBeNull();
  });
});
