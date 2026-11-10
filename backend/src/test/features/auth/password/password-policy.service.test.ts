import { RequestValidationError } from "@/configuration/validation/request";
import type { BreachCheckResult } from "@/features/auth/password/policy/breached-password.client";
import {
  BREACHED_PASSWORD_MESSAGE,
  BREACHED_PASSWORD_WARNING,
  COMMON_PASSWORD_MESSAGE,
  PERSONAL_INFO_PASSWORD_MESSAGE,
  PasswordPolicyService,
} from "@/features/auth/password/policy/password-policy.service";
import { PASSWORD_TOO_SHORT_MESSAGE } from "@/features/auth/password/policy/password-rules";
import { UNSAFE_AUTH_INPUT_MESSAGE } from "@/features/auth/unsafe-input";

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

  it("refuses markup the submit schema would refuse", async () => {
    const { service } = createService();

    await expect(
      service.evaluate("<b>tidal-harbor-lantern</b>", CONTEXT),
    ).resolves.toEqual({
      issues: [{ code: "unsafe_input", message: UNSAFE_AUTH_INPUT_MESSAGE }],
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

describe("PasswordPolicyService breach check", () => {
  function createBreachService(
    mode: "off" | "warn" | "enforce",
    result: BreachCheckResult,
  ) {
    const check = jest.fn(async (_password: string) => result);
    const logger = { info: jest.fn(), warn: jest.fn() };
    const service = new PasswordPolicyService({
      isCommon: () => false,
      breachChecker: { check },
      getBreachCheckConfig: () => ({ mode }),
      logger: logger as never,
    });

    return { service, check, logger };
  }

  it("does not ask when the check is off", async () => {
    const { service, check } = createBreachService("off", {
      status: "breached",
      count: 9,
    });

    await expect(
      service.evaluate("tidal-harbor-lantern", CONTEXT),
    ).resolves.toEqual({ issues: [], warnings: [] });
    expect(check).not.toHaveBeenCalled();
  });

  it("does not ask about a password the local checks already refuse", async () => {
    const { service, check } = createBreachService("enforce", {
      status: "breached",
      count: 9,
    });

    await service.evaluate("short", CONTEXT);
    await service.evaluate("<b>tidal-harbor-lantern</b>", CONTEXT);
    expect(check).not.toHaveBeenCalled();
  });

  it("refuses a breached password in enforce mode", async () => {
    const { service, check } = createBreachService("enforce", {
      status: "breached",
      count: 9,
    });

    await expect(
      service.evaluate("tidal-harbor-lantern", CONTEXT),
    ).resolves.toEqual({
      issues: [{ code: "breached", message: BREACHED_PASSWORD_MESSAGE }],
      warnings: [],
    });
    expect(check).toHaveBeenCalledWith("tidal-harbor-lantern");
    await expect(
      service.assertAcceptable("tidal-harbor-lantern", CONTEXT, "password"),
    ).rejects.toBeInstanceOf(RequestValidationError);
  });

  it("only warns about a breached password in warn mode", async () => {
    const { service } = createBreachService("warn", {
      status: "breached",
      count: 9,
    });

    await expect(
      service.evaluate("tidal-harbor-lantern", CONTEXT),
    ).resolves.toEqual({
      issues: [],
      warnings: [{ code: "breached", message: BREACHED_PASSWORD_WARNING }],
    });
    await expect(
      service.assertAcceptable("tidal-harbor-lantern", CONTEXT, "password"),
    ).resolves.toBeUndefined();
  });

  it("accepts a clean password", async () => {
    const { service } = createBreachService("enforce", { status: "clean" });

    await expect(
      service.evaluate("tidal-harbor-lantern", CONTEXT),
    ).resolves.toEqual({ issues: [], warnings: [] });
  });

  it("fails open with a warning log when the check is unavailable", async () => {
    const { service, logger } = createBreachService("enforce", {
      status: "unavailable",
      reason: "timeout",
    });

    await expect(
      service.assertAcceptable("tidal-harbor-lantern", CONTEXT, "password"),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "Breached-password check unavailable; accepting password.",
      { reason: "timeout" },
    );
    // The password itself is never logged.
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("tidal");
  });
});
