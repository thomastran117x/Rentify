import { RequestValidationError } from "@/configuration/validation/request";
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

export type PasswordEvaluation = {
  /** Reasons the password would be refused. Empty means it is acceptable. */
  issues: PasswordIssue[];
  /** Advice that does not block the password. */
  warnings: PasswordIssue[];
};

export type PasswordPolicyServiceOptions = {
  isCommon?: CommonPasswordMatcher;
};

/**
 * The checks on a new local password that need more than its shape. Each
 * service that sets a password calls `assertAcceptable` once it knows whose
 * account it is, and before the password is hashed.
 */
export class PasswordPolicyService {
  private readonly isCommon: CommonPasswordMatcher;

  constructor(options: PasswordPolicyServiceOptions = {}) {
    this.isCommon = options.isCommon ?? isCommonPassword;
  }

  async evaluate(
    password: string,
    context: PasswordPersonalContext,
  ): Promise<PasswordEvaluation> {
    const issues = checkPasswordShape(password);

    if (this.isCommon(password)) {
      issues.push({ code: "common", message: COMMON_PASSWORD_MESSAGE });
    }

    if (containsPersonalInfo(password, context)) {
      issues.push({
        code: "contains_personal_info",
        message: PERSONAL_INFO_PASSWORD_MESSAGE,
      });
    }

    return { issues, warnings: [] };
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
}
