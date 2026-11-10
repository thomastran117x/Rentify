import type { Request, Response } from "express";
import { parseRequestBody } from "@/configuration/validation/request";
import { accepted, ok } from "@/configuration/http/responses";
import { getOptionalJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { writeAuthSessionResponse } from "@/features/auth/auth.response";
import {
  toChangePasswordInput,
  toForgotPasswordInput,
  toResendForgotPasswordInput,
  toResetPasswordInput,
  toSetPasswordInput,
} from "@/features/auth/auth.request-mappers";
import { CaptchaService } from "@/features/auth/captcha/captcha.service";
import { CAPTCHA_ACTIONS } from "@/features/auth/captcha/captcha.actions";
import { requireCaptcha } from "@/features/auth/captcha/captcha.guard";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import { requireRecentMfaVerification } from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import { PasswordService } from "@/features/auth/password/password.service";
import {
  changePasswordRequestSchema,
  checkPasswordRequestSchema,
  forgotPasswordRequestSchema,
  resendForgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  setPasswordRequestSchema,
} from "@/features/auth/password/password.model";

export class PasswordController {
  constructor(
    private readonly passwordService: PasswordService,
    private readonly captchaService: CaptchaService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

  /**
   * Public, so signup can use it, with optional auth so the account page is
   * checked against the account. No captcha: it changes nothing, and the
   * `password-check` rate limit bounds it.
   */
  checkPassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(request, checkPasswordRequestSchema);
    const auth = await getOptionalJwtAuth(request);
    const result = await this.passwordService.checkPassword({
      password: input.password,
      userId: auth?.sub,
      context: {
        username: input.username,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    });

    ok(response, result);
  };

  forgotPassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(request, forgotPasswordRequestSchema);
    await requireCaptcha(
      request,
      this.captchaService,
      input.captchaToken,
      CAPTCHA_ACTIONS.passwordReset,
    );
    const result = await this.passwordService.forgotPassword(
      toForgotPasswordInput(request, input),
    );
    accepted(response, result, {
      message: "Password reset instructions have been accepted.",
    });
  };

  resendForgotPassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      resendForgotPasswordRequestSchema,
    );
    await requireCaptcha(
      request,
      this.captchaService,
      input.captchaToken,
      CAPTCHA_ACTIONS.passwordReset,
    );
    const result = await this.passwordService.resendForgotPassword(
      toResendForgotPasswordInput(request, input),
    );
    accepted(response, result, {
      message: "Password reset instructions have been re-sent.",
    });
  };

  resetPassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(request, resetPasswordRequestSchema);
    await requireCaptcha(
      request,
      this.captchaService,
      input.captchaToken,
      CAPTCHA_ACTIONS.passwordReset,
    );
    const result = await this.passwordService.resetPassword(
      toResetPasswordInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Password reset successfully.",
    });
  };

  changePassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(request, changePasswordRequestSchema);
    const result = await this.passwordService.changePassword(
      toChangePasswordInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Password changed successfully.",
    });
  };

  setPassword = async (request: Request, response: Response): Promise<void> => {
    await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(request, setPasswordRequestSchema);
    const result = await this.passwordService.setPassword(
      toSetPasswordInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Password set successfully.",
    });
  };
}
