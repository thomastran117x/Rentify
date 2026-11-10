import { describe, expect, it } from "vitest";
import { ApiClientError } from "./types";
import { getValidationFieldMessage } from "./validation-details";

const request = {
  method: "POST",
  path: "/auth/local/signup",
  requestUrl: "/api/v1/auth/local/signup",
} as const;

function validationError(details: unknown, code = "VALIDATION_ERROR") {
  return new ApiClientError("Request body validation failed.", {
    code,
    status: 400,
    details,
    request,
  });
}

describe("getValidationFieldMessage", () => {
  it("joins every message listed under the field", () => {
    expect(
      getValidationFieldMessage(
        validationError({ password: ["Too common.", "Contains your name."] }),
        "password",
      ),
    ).toBe("Too common. Contains your name.");
  });

  it("returns null for another field, another code or another error", () => {
    expect(
      getValidationFieldMessage(
        validationError({ email: ["Invalid."] }),
        "password",
      ),
    ).toBeNull();
    expect(
      getValidationFieldMessage(
        validationError({ password: ["x"] }, "BAD_REQUEST"),
        "password",
      ),
    ).toBeNull();
    expect(getValidationFieldMessage(new Error("x"), "password")).toBeNull();
    expect(
      getValidationFieldMessage(validationError(null), "password"),
    ).toBeNull();
  });

  it("ignores non-string entries and empty lists", () => {
    expect(
      getValidationFieldMessage(
        validationError({ password: [42, "", "Kept."] }),
        "password",
      ),
    ).toBe("Kept.");
    expect(
      getValidationFieldMessage(validationError({ password: [] }), "password"),
    ).toBeNull();
    expect(
      getValidationFieldMessage(
        validationError({ password: "not a list" }),
        "password",
      ),
    ).toBeNull();
  });
});
