import { environment } from "@/configuration/environment";
import type { AppEnvironment } from "@/configuration/environment/types";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { RequestValidationError } from "@/configuration/validation/request";
import {
  type BreachedPasswordChecker,
  PwnedPasswordsClient,
} from "@/features/auth/password/policy/breached-password.client";
import {
  type CommonPasswordMatcher,
  isCommonPassword,
} from "@/features/auth/password/policy/common-passwords";
import {
  type PasswordPersonalContext,
  containsPersonalInfo,
} from "@/features/auth/password/policy/personal-info";
import {
  type PasswordIssue,
  checkPasswordShape,
} from "@/features/auth/password/policy/password-rules";

export const COMMON_PASSWORD_MESSAGE =
  "This password is too common or easy to guess. Choose something less predictable.";
export const PERSONAL_INFO_PASSWORD_MESSAGE =
  "Password must not contain your name, username or email address.";
export const BREACHED_PASSWORD_MESSAGE =
  "This password has appeared in a known data breach. Choose a different one.";
export const BREACHED_PASSWORD_WARNING =
  "This password has appeared in a known data breach. Consider choosing a different one.";

type BreachCheckConfig =
  AppEnvironment["authSecurity"]["passwords"]["breachCheck"];

export type PasswordEvaluation = {
  /** Reasons the password would be refused. Empty means it is acceptable. */
  issues: PasswordIssue[];
  /** Advice that does not block the password. */
  warnings: PasswordIssue[];
};

export type PasswordPolicyServiceOptions = {
  isCommon?: CommonPasswordMatcher;
  breachChecker?: BreachedPasswordChecker;
  getBreachCheckConfig?: () => Pick<BreachCheckConfig, "mode">;
  logger?: Logger;
};

/**
 * The checks on a new local password that need more than its shape. Each
 * service that sets a password calls `assertAcceptable` once it knows whose
 * account it is, and before the password is hashed.
 */
export class PasswordPolicyService {
  private readonly isCommon: CommonPasswordMatcher;
  private readonly breachChecker: BreachedPasswordChecker;
  private readonly getBreachCheckConfig: () => Pick<BreachCheckConfig, "mode">;
  private readonly logger: Logger;

  constructor(options: PasswordPolicyServiceOptions = {}) {
    this.isCommon = options.isCommon ?? isCommonPassword;
    this.breachChecker = options.breachChecker ?? new PwnedPasswordsClient();
    this.getBreachCheckConfig =
      options.getBreachCheckConfig ??
      (() => environment.getAuthSecurityConfig().passwords.breachCheck);
    this.logger =
      options.logger ??
      loggerFactory.forClass(PasswordPolicyService, "service");
  }

  async evaluate(
    password: string,
    context: PasswordPersonalContext,
  ): Promise<PasswordEvaluation> {
    const issues = checkPasswordShape(password);
    const warnings: PasswordIssue[] = [];

    if (this.isCommon(password)) {
      issues.push({ code: "common", message: COMMON_PASSWORD_MESSAGE });
    }

    if (containsPersonalInfo(password, context)) {
      issues.push({
        code: "contains_personal_info",
        message: PERSONAL_INFO_PASSWORD_MESSAGE,
      });
    }

    // Only a password that would otherwise pass is worth the round trip.
    if (issues.length === 0) {
      await this.checkBreaches(password, issues, warnings);
    }

    return { issues, warnings };
  }

  /**
   * Throws the same `400 VALIDATION_ERROR` a schema failure would, with every
   * reason under `field`, so a form can show them on the password input.
   */
  async assertAcceptable(
    password: string,
    context: PasswordPersonalContext,
    field: string,
  ): Promise<void> {
    const { issues } = await this.evaluate(password, context);

    if (issues.length > 0) {
      throw new RequestValidationError(
        "Request body validation failed.",
        issues.map((issue) => ({ path: field, message: issue.message })),
      );
    }
  }

  private async checkBreaches(
    password: string,
    issues: PasswordIssue[],
    warnings: PasswordIssue[],
  ): Promise<void> {
    const { mode } = this.getBreachCheckConfig();

    if (mode === "off") {
      return;
    }

    const result = await this.breachChecker.check(password);

    if (result.status === "unavailable") {
      // Fails open: an outage at Have I Been Pwned must not stop signups,
      // resets or changes. The other checks have already passed.
      this.logger.warn(
        "Breached-password check unavailable; accepting password.",
        { reason: result.reason },
      );
      return;
    }

    if (result.status === "breached") {
      this.logger.info("New password found in a known breach.", { mode });

      if (mode === "enforce") {
        issues.push({ code: "breached", message: BREACHED_PASSWORD_MESSAGE });
      } else {
        warnings.push({ code: "breached", message: BREACHED_PASSWORD_WARNING });
      }
    }
  }
}
