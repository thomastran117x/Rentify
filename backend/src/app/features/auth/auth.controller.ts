import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import {
  clearCookie,
  getQuery,
  getRequestUrl,
  readCookie,
  writeCookie,
} from "@/configuration/http/request";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { resolveIdempotencyKey } from "@/configuration/middlewares/idempotency.middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { RequestValidationError } from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import { environment } from "@/configuration/environment";
import { accepted, ok } from "@/configuration/http/responses";
import BadRequestError from "@/errors/http/bad-request.error";
import { AuthService } from "@/features/auth/auth.service";
import { CaptchaService } from "@/features/auth/captcha/captcha.service";
import {
  CSRF_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import { TokenService } from "@/features/auth/token/token.service";
import type {
  AuthResponseBody,
  AuthSessionResult,
  ChangePasswordInput,
  ChangePasswordRequestBody,
  ForgotPasswordInput,
  ForgotPasswordRequestBody,
  ForgotUsernameInput,
  ForgotUsernameRequestBody,
  LinkOAuthProviderInput,
  LocalAuthenticateInput,
  LocalAuthenticateRequestBody,
  LocalSignupInput,
  LocalSignupRequestBody,
  OAuthAuthenticateInput,
  OAuthAuthenticateRequestBody,
  OAuthProvider,
  RefreshInput,
  RefreshRequestBody,
  ResetPasswordInput,
  ResetPasswordRequestBody,
  RemoveKnownDeviceInput,
  RemoveKnownDeviceRequestBody,
  ResendForgotPasswordInput,
  ResendForgotPasswordRequestBody,
  ResendUnlockLocalLoginInput,
  ResendUnlockLocalLoginRequestBody,
  ResendVerificationEmailInput,
  ResendVerificationEmailRequestBody,
  SignupVerificationPendingResult,
  UnlinkOAuthProviderInput,
  UnlockLocalLoginInput,
  UnlockLocalLoginRequestBody,
  VerifyEmailInput,
  VerifyEmailRequestBody,
} from "@/features/auth/auth.model";
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  forgotUsernameRequestSchema,
  localAuthenticateRequestSchema,
  localSignupRequestSchema,
  oauthAuthenticateRequestSchema,
  oauthProviderSchema,
  refreshRequestSchema,
  removeKnownDeviceRequestSchema,
  resendForgotPasswordRequestSchema,
  resendUnlockLocalLoginRequestSchema,
  resetPasswordRequestSchema,
  resendVerificationEmailRequestSchema,
  unlockLocalLoginRequestSchema,
  verifyEmailRequestSchema,
} from "@/features/auth/auth.model";
import { ZodError } from "zod";
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
    await this.verifyCaptcha(request, input.captchaToken);
    const result = await this.authService.localAuthenticate(
      this.toLocalAuthenticateInput(request, input),
    );

    this.json(request, response, result, {
      message: "Authenticated successfully.",
    });
  };

  localSignup = async (request: Request, response: Response): Promise<void> => {
    const input = await parseRequestBody(request, localSignupRequestSchema);
    await this.verifyCaptcha(request, input.captchaToken);
    const result = await this.authService.localSignup(
      this.toLocalSignupInput(request, input),
    );

    accepted(response, result, {
      message: "Signup verification is pending.",
    });
  };

  forgotPassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(request, forgotPasswordRequestSchema);
    await this.verifyCaptcha(request, input.captchaToken);
    const result = await this.authService.forgotPassword(
      this.toForgotPasswordInput(request, input),
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
    await this.verifyCaptcha(request, input.captchaToken);
    const result = await this.authService.resendForgotPassword(
      this.toResendForgotPasswordInput(request, input),
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
    await this.verifyCaptcha(request, input.captchaToken);
    const result = await this.authService.forgotUsername(
      this.toForgotUsernameInput(request, input),
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
      this.toResetPasswordInput(request, input),
    );
    this.json(request, response, result, {
      message: "Password reset successfully.",
    });
  };

  verifyEmail = async (request: Request, response: Response): Promise<void> => {
    const input = await parseRequestBody(request, verifyEmailRequestSchema);
    const result = await this.authService.verifyEmail(
      this.toVerifyEmailInput(request, input),
    );
    this.json(request, response, result, {
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
    await this.verifyCaptcha(request, input.captchaToken);
    const result = await this.authService.resendVerificationEmail(
      this.toResendVerificationEmailInput(request, input),
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
      this.toChangePasswordInput(request, input),
    );
    this.json(request, response, result, {
      message: "Password changed successfully.",
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
      this.toUnlockLocalLoginInput(input),
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
    await this.verifyCaptcha(request, input.captchaToken);
    const result = await this.authService.resendUnlockLocalLogin(
      this.toResendUnlockLocalLoginInput(request, input),
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
      this.toOAuthAuthenticateInput(request, input),
    );
    this.json(request, response, result, {
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
      this.toOAuthAuthenticateInput(request, input),
    );
    this.json(request, response, result, {
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
      this.toOAuthAuthenticateInput(request, input),
    );
    this.json(request, response, result, {
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
      this.toLinkOAuthProviderInput(request, input),
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
      this.toUnlinkOAuthProviderInput(request),
    );
    ok(response, result, {
      message: "OAuth provider unlinked successfully.",
    });
  };

  refresh = async (request: Request, response: Response): Promise<void> => {
    const input = await parseRequestBody(request, refreshRequestSchema);
    const result = await this.authService.refresh(
      this.toRefreshInput(request, input),
    );
    this.json(request, response, result, {
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

    clearCookie(response, REFRESH_TOKEN_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      secure: this.isSecureCookieEnabled(),
      sameSite: "Lax",
    });
    clearCookie(response, CSRF_TOKEN_COOKIE_NAME, {
      path: "/",
      secure: this.isSecureCookieEnabled(),
      sameSite: "Lax",
    });

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
      this.toRemoveKnownDeviceInput(request, input),
    );
    ok(response, result, {
      message: "Known device removed successfully.",
    });
  };

  /**
   * Writes an authenticated session response, setting the refresh and CSRF
   * cookies for browser clients.
   */
  private json(
    request: Request,
    response: Response,
    body: AuthSessionResult,
    options?: {
      message?: string;
    },
  ): void {
    const responseBody = this.toAuthResponseBody(request, body);

    if (this.shouldSetRefreshCookie(request)) {
      this.setBrowserSessionCookies(response, body);
    }

    ok(response, responseBody, options);
  }

  private toLocalAuthenticateInput(
    request: Request,
    input: LocalAuthenticateRequestBody,
  ): LocalAuthenticateInput {
    return {
      username: input.username,
      password: input.password,
      rememberMe: input.rememberMe,
      client: request.client,
      deviceId: this.resolveDeviceId(request, input.deviceId),
      totpCode: input.totpCode,
    };
  }

  private toLocalSignupInput(
    request: Request,
    input: LocalSignupRequestBody,
  ): LocalSignupInput {
    return {
      client: request.client,
      username: input.username,
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      deviceId: this.resolveDeviceId(request, input.deviceId),
    };
  }

  private toOAuthAuthenticateInput(
    request: Request,
    input: OAuthAuthenticateRequestBody,
  ): OAuthAuthenticateInput {
    return {
      code: input.code,
      codeVerifier: input.codeVerifier,
      idToken: input.idToken,
      nonce: input.nonce,
      rememberMe: input.rememberMe,
      client: request.client,
      firstName: input.firstName,
      lastName: input.lastName,
      deviceId: this.resolveDeviceId(request, input.deviceId),
      totpCode: input.totpCode,
    };
  }

  private toLinkOAuthProviderInput(
    request: Request,
    input: OAuthAuthenticateRequestBody,
  ): LinkOAuthProviderInput {
    return {
      ...this.toOAuthAuthenticateInput(request, input),
      provider: this.requireOAuthProviderParam(request),
      userId: request.auth.sub,
    };
  }

  private toUnlinkOAuthProviderInput(
    request: Request,
  ): UnlinkOAuthProviderInput {
    return {
      provider: this.requireOAuthProviderParam(request),
      userId: request.auth.sub,
    };
  }

  private requireOAuthProviderParam(request: Request): OAuthProvider {
    const provider = requireSafeRouteParam(request, "provider");

    try {
      return oauthProviderSchema.parse(provider);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new RequestValidationError(
          "Route parameter validation failed.",
          error.issues.map((issue) => ({
            path: "provider",
            message: issue.message,
          })),
        );
      }

      throw error;
    }
  }

  private resolveDeviceId(
    request: Request,
    deviceId?: string,
  ): string | undefined {
    return deviceId ?? request.client.device.id;
  }

  private toVerifyEmailInput(
    request: Request,
    input: VerifyEmailRequestBody,
  ): VerifyEmailInput {
    return {
      client: request.client,
      email: input.email,
      code: input.code,
      deviceId: this.resolveDeviceId(request, input.deviceId),
    };
  }

  private toResendVerificationEmailInput(
    request: Request,
    input: ResendVerificationEmailRequestBody,
  ): ResendVerificationEmailInput {
    return {
      client: request.client,
      email: input.email,
      deviceId: this.resolveDeviceId(request),
    };
  }

  private toForgotPasswordInput(
    request: Request,
    input: ForgotPasswordRequestBody,
  ): ForgotPasswordInput {
    return {
      client: request.client,
      username: input.username,
      deviceId: this.resolveDeviceId(request),
    };
  }

  private toResendForgotPasswordInput(
    request: Request,
    input: ResendForgotPasswordRequestBody,
  ): ResendForgotPasswordInput {
    return {
      client: request.client,
      username: input.username,
      deviceId: this.resolveDeviceId(request),
    };
  }

  private toForgotUsernameInput(
    request: Request,
    input: ForgotUsernameRequestBody,
  ): ForgotUsernameInput {
    return {
      client: request.client,
      email: input.email,
      deviceId: this.resolveDeviceId(request),
    };
  }

  private toRefreshInput(
    request: Request,
    input: RefreshRequestBody,
  ): RefreshInput {
    return {
      client: request.client,
      refreshToken:
        input.refreshToken ?? readCookie(request, REFRESH_TOKEN_COOKIE_NAME),
    };
  }

  private toResetPasswordInput(
    request: Request,
    input: ResetPasswordRequestBody,
  ): ResetPasswordInput {
    return {
      client: request.client,
      username: input.username,
      code: input.code,
      newPassword: input.newPassword,
      deviceId: this.resolveDeviceId(request, input.deviceId),
    };
  }

  private toRemoveKnownDeviceInput(
    request: Request,
    input: RemoveKnownDeviceRequestBody,
  ): RemoveKnownDeviceInput {
    return {
      userId: request.auth.sub,
      deviceId: input.deviceId,
    };
  }

  private toUnlockLocalLoginInput(
    input: UnlockLocalLoginRequestBody,
  ): UnlockLocalLoginInput {
    return {
      email: input.email,
      code: input.code,
    };
  }

  private toResendUnlockLocalLoginInput(
    request: Request,
    input: ResendUnlockLocalLoginRequestBody,
  ): ResendUnlockLocalLoginInput {
    return {
      client: request.client,
      email: input.email,
      deviceId: this.resolveDeviceId(request),
    };
  }

  private toChangePasswordInput(
    request: Request,
    input: ChangePasswordRequestBody,
  ): ChangePasswordInput {
    return {
      userId: request.auth.sub,
      client: request.client,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      deviceId: request.auth.deviceId ?? request.client.device.id,
    };
  }

  private toAuthResponseBody(
    request: Request,
    result: AuthSessionResult,
  ): AuthResponseBody {
    const responseBody: AuthResponseBody = {
      accessToken: result.accessToken,
      device: result.device,
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        avatarUrl: result.user.avatarUrl,
        role: result.user.role,
        activeOrganization: result.user.activeOrganization,
        organizationMembershipCount: result.user.organizationMembershipCount,
      },
    };

    if (!this.shouldSetRefreshCookie(request)) {
      responseBody.refreshToken = result.refreshToken;
    }

    if (result.isNewUser) {
      responseBody.isNewUser = true;
    }

    return responseBody;
  }

  private shouldSetRefreshCookie(request: Request): boolean {
    return this.isBrowserRequest(request);
  }

  private isBrowserRequest(request: Request): boolean {
    return Boolean(
      request.get("origin") ||
        request.get("referer") ||
        request.get("sec-fetch-site"),
    );
  }

  private isSecureCookieEnabled(): boolean {
    return environment.isProduction();
  }

  private createCsrfToken(): string {
    return randomUUID();
  }

  private setBrowserSessionCookies(
    response: Response,
    result: AuthSessionResult,
  ): void {
    const secure = this.isSecureCookieEnabled();

    writeCookie(response, REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, {
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "Lax",
      maxAge: result.refreshTokenExpiresInSeconds,
    });
    writeCookie(response, CSRF_TOKEN_COOKIE_NAME, this.createCsrfToken(), {
      path: "/",
      secure,
      sameSite: "Lax",
      maxAge: result.refreshTokenExpiresInSeconds,
    });
  }
  private async verifyCaptcha(
    request: Request,
    captchaToken: string,
  ): Promise<void> {
    const result = await this.captchaService.verify({
      token: captchaToken,
      remoteIp: request.client.ip,
      idempotencyKey: resolveIdempotencyKey(request),
    });

    if (!result.success || result.failOpen) {
      throw new BadRequestError("Captcha verification failed.", {
        errors: result.errors,
        failOpen: result.failOpen,
      });
    }
  }
}
