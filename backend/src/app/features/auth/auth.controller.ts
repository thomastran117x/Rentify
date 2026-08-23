import type { Request, Response } from "express";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { getOptionalJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { readCookie } from "@/configuration/http/request";
import { accepted, ok } from "@/configuration/http/responses";
import { AuthService } from "@/features/auth/auth.service";
import { CaptchaService } from "@/features/auth/captcha/captcha.service";
import { TokenService } from "@/features/auth/token/token.service";
import { requireCaptcha } from "@/features/auth/captcha/captcha.guard";
import { REFRESH_TOKEN_COOKIE_NAME } from "@/features/auth/auth.cookies";
import {
  clearBrowserSessionCookies,
  writeAuthSessionResponse,
} from "@/features/auth/auth.response";
import {
  parseUsernameAvailabilityQuery,
  toChangePasswordInput,
  toForgotPasswordInput,
  toForgotUsernameInput,
  toLinkOAuthProviderInput,
  toLocalAuthenticateInput,
  toLocalSignupInput,
  toOAuthAuthenticateInput,
  toRefreshInput,
  toRemoveKnownDeviceInput,
  toResendForgotPasswordInput,
  toResendUnlockLocalLoginInput,
  toResendVerificationEmailInput,
  toResetPasswordInput,
  toSetPasswordInput,
  toUnlinkOAuthProviderInput,
  toUnlockLocalLoginInput,
  toVerifyEmailInput,
} from "@/features/auth/auth.request-mappers";
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  forgotUsernameRequestSchema,
  localAuthenticateRequestSchema,
  localSignupRequestSchema,
  oauthAuthenticateRequestSchema,
  refreshRequestSchema,
  removeKnownDeviceRequestSchema,
  resendForgotPasswordRequestSchema,
  resendUnlockLocalLoginRequestSchema,
  resetPasswordRequestSchema,
  resendVerificationEmailRequestSchema,
  setPasswordRequestSchema,
  unlockLocalLoginRequestSchema,
  verifyEmailRequestSchema,
} from "@/features/auth/auth.model";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import { requireRecentMfaVerification } from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
    private readonly tokenService: TokenService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

  localAuthenticate = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      localAuthenticateRequestSchema,
    );
    await requireCaptcha(request, this.captchaService, input.captchaToken);
    const result = await this.authService.localAuthenticate(
      toLocalAuthenticateInput(request, input),
    );

    writeAuthSessionResponse(request, response, result, {
      message: "Authenticated successfully.",
    });
  };

  localSignup = async (request: Request, response: Response): Promise<void> => {
    const input = await parseRequestBody(request, localSignupRequestSchema);
    await requireCaptcha(request, this.captchaService, input.captchaToken);
    const result = await this.authService.localSignup(
      toLocalSignupInput(request, input),
    );

    accepted(response, result, {
      message: "Signup verification is pending.",
    });
  };

  checkUsernameAvailability = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = parseUsernameAvailabilityQuery(request);
    // Public endpoint, but a signed-in caller's own username must report as
    // available rather than taken so the settings form does not flag the value
    // it was seeded with.
    const auth = await getOptionalJwtAuth(request);
    // Bloom-filter backed: a name nobody has claimed is answered from memory,
    // and anything the filter cannot rule out falls through to the same
    // database lookup this used to call directly.
    const result = await this.authService.resolveUsernameAvailabilityHint(
      query.username,
      auth?.sub,
    );

    ok(response, result);
  };

  forgotPassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(request, forgotPasswordRequestSchema);
    await requireCaptcha(request, this.captchaService, input.captchaToken);
    const result = await this.authService.forgotPassword(
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
    await requireCaptcha(request, this.captchaService, input.captchaToken);
    const result = await this.authService.resendForgotPassword(
      toResendForgotPasswordInput(request, input),
    );
    accepted(response, result, {
      message: "Password reset instructions have been re-sent.",
    });
  };

  forgotUsername = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(request, forgotUsernameRequestSchema);
    await requireCaptcha(request, this.captchaService, input.captchaToken);
    const result = await this.authService.forgotUsername(
      toForgotUsernameInput(request, input),
    );
    accepted(response, result, {
      message: "Username reminder instructions have been accepted.",
    });
  };

  resetPassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(request, resetPasswordRequestSchema);
    const result = await this.authService.resetPassword(
      toResetPasswordInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Password reset successfully.",
    });
  };

  verifyEmail = async (request: Request, response: Response): Promise<void> => {
    const input = await parseRequestBody(request, verifyEmailRequestSchema);
    const result = await this.authService.verifyEmail(
      toVerifyEmailInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Email verified successfully.",
    });
  };

  resendVerificationEmail = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      resendVerificationEmailRequestSchema,
    );
    await requireCaptcha(request, this.captchaService, input.captchaToken);
    const result = await this.authService.resendVerificationEmail(
      toResendVerificationEmailInput(request, input),
    );
    accepted(response, result, {
      message: "Verification email has been re-sent.",
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
    const result = await this.authService.changePassword(
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
    const result = await this.authService.setPassword(
      toSetPasswordInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Password set successfully.",
    });
  };

  unlockLocalLogin = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      unlockLocalLoginRequestSchema,
    );
    const result = await this.authService.unlockLocalLogin(
      toUnlockLocalLoginInput(input),
    );
    ok(response, result, {
      message: "Local login unlocked successfully.",
    });
  };

  resendUnlockLocalLogin = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      resendUnlockLocalLoginRequestSchema,
    );
    await requireCaptcha(request, this.captchaService, input.captchaToken);
    const result = await this.authService.resendUnlockLocalLogin(
      toResendUnlockLocalLoginInput(request, input),
    );
    accepted(response, result, {
      message: "Unlock email has been re-sent.",
    });
  };

  localVerify = async (request: Request, response: Response): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.authService.localVerify({
      auth: request.auth,
      client: request.client,
    });
    ok(response, result);
  };

  googleAuthenticate = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.authService.googleAuthenticate(
      toOAuthAuthenticateInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Authenticated successfully.",
    });
  };

  microsoftAuthenticate = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.authService.microsoftAuthenticate(
      toOAuthAuthenticateInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Authenticated successfully.",
    });
  };

  appleAuthenticate = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.authService.appleAuthenticate(
      toOAuthAuthenticateInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Authenticated successfully.",
    });
  };

  linkOAuthProvider = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireJwtAuth(request);
    const input = await parseRequestBody(
      request,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.authService.linkOAuthProvider(
      toLinkOAuthProviderInput(request, input),
    );
    ok(response, result, {
      message: "OAuth provider linked successfully.",
    });
  };

  linkedOAuthProviders = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.authService.linkedOAuthProviders({
      userId: request.auth.sub,
    });
    ok(response, result);
  };

  unlinkOAuthProvider = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.authService.unlinkOAuthProvider(
      toUnlinkOAuthProviderInput(request),
    );
    ok(response, result, {
      message: "OAuth provider unlinked successfully.",
    });
  };

  refresh = async (request: Request, response: Response): Promise<void> => {
    const input = await parseRequestBody(request, refreshRequestSchema);
    const result = await this.authService.refresh(
      toRefreshInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Session refreshed successfully.",
    });
  };

  logout = async (request: Request, response: Response): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.authService.logout({
      auth: request.auth,
      client: request.client,
      refreshToken: readCookie(request, REFRESH_TOKEN_COOKIE_NAME),
    });

    clearBrowserSessionCookies(response);

    ok(response, result, {
      message: "Logged out successfully.",
    });
  };

  deviceVerify = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.authService.deviceVerify({
      auth: request.auth,
      client: request.client,
    });
    ok(response, result, {
      message: "Device verified successfully.",
    });
  };

  devices = async (request: Request, response: Response): Promise<void> => {
    await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const result = await this.authService.devices({
      auth: request.auth,
      client: request.client,
    });
    ok(response, result);
  };

  removeKnownDevice = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(
      request,
      removeKnownDeviceRequestSchema,
    );
    const result = await this.authService.removeKnownDevice(
      toRemoveKnownDeviceInput(request, input),
    );
    ok(response, result, {
      message: "Known device removed successfully.",
    });
  };

}
