import { RequestValidationError } from "@/configuration/validation/request";
import {
  COMMON_PASSWORD_MESSAGE,
  PERSONAL_INFO_PASSWORD_MESSAGE,
  PasswordPolicyService,
} from "@/features/auth/password/policy/password-policy.service";
import { PASSWORD_TOO_SHORT_MESSAGE } from "@/features/auth/password/policy/password-rules";

const CONTEXT = { username: "renter-one", email: "user1@rentify.local" };

function createService() {
  const isCommon = jest.fn((password: string) =>
    password.startsWith("password"),
  );

  return { service: new PasswordPolicyService({ isCommon }), isCommon };
}

describe("PasswordPolicyService.evaluate", () => {
  it("accepts a long, unrelated password", async () => {
    const { service } = createService();

    await expect(
      service.evaluate("tidal-harbor-lantern", CONTEXT),
    ).resolves.toEqual({ issues: [], warnings: [] });
  });

  it("reports every reason at once", async () => {
    const { service } = createService();

    await expect(service.evaluate("passwordrent", CONTEXT)).resolves.toEqual({
      issues: [{ code: "common", message: COMMON_PASSWORD_MESSAGE }],
      warnings: [],
    });
    await expect(
      service.evaluate("password-renter-one", CONTEXT),
    ).resolves.toEqual({
      issues: [
        { code: "common", message: COMMON_PASSWORD_MESSAGE },
        {
          code: "contains_personal_info",
          message: PERSONAL_INFO_PASSWORD_MESSAGE,
        },
      ],
      warnings: [],
    });
    await expect(service.evaluate("short", CONTEXT)).resolves.toEqual({
      issues: [{ code: "too_short", message: PASSWORD_TOO_SHORT_MESSAGE }],
      warnings: [],
    });
  });

  it("uses the bundled list by default", async () => {
    await expect(
      new PasswordPolicyService().evaluate("password1234", {}),
    ).resolves.toMatchObject({ issues: [{ code: "common" }] });
  });
});

describe("PasswordPolicyService.assertAcceptable", () => {
  it("resolves for an acceptable password", async () => {
    const { service } = createService();

    await expect(
      service.assertAcceptable("tidal-harbor-lantern", CONTEXT, "newPassword"),
    ).resolves.toBeUndefined();
  });

  it("throws a validation error with each reason under the field", async () => {
    const { service } = createService();
    const error = await service
      .assertAcceptable("password-user1-x", CONTEXT, "newPassword")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RequestValidationError);
    expect((error as RequestValidationError).details).toEqual([
      { path: "newPassword", message: COMMON_PASSWORD_MESSAGE },
      { path: "newPassword", message: PERSONAL_INFO_PASSWORD_MESSAGE },
    ]);
  });
});
