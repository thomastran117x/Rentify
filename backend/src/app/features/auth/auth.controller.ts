import { randomUUID } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
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
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const input = await parseRequestBody(
      context,
      localAuthenticateRequestSchema,
    );
    await this.verifyCaptcha(context, input.captchaToken);
    const result = await this.authService.localAuthenticate(
      this.toLocalAuthenticateInput(context, input),
    );

    return this.json(context, result, {
      message: "Authenticated successfully.",
    });
  };

  localSignup = async (context: Context<AppBindings>): Promise<Response> => {
    const input = await parseRequestBody(context, localSignupRequestSchema);
    await this.verifyCaptcha(context, input.captchaToken);
    const result = await this.authService.localSignup(
      this.toLocalSignupInput(context, input),
    );

    return accepted(context, result, {
      message: "Signup verification is pending.",
    });
  };

  forgotPassword = async (context: Context<AppBindings>): Promise<Response> => {
    const input = await parseRequestBody(context, forgotPasswordRequestSchema);
    await this.verifyCaptcha(context, input.captchaToken);
    const result = await this.authService.forgotPassword(
      this.toForgotPasswordInput(context, input),
    );
    return accepted(context, result, {
      message: "Password reset instructions have been accepted.",
    });
  };

  resendForgotPassword = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const input = await parseRequestBody(
      context,
      resendForgotPasswordRequestSchema,
    );
    await this.verifyCaptcha(context, input.captchaToken);
    const result = await this.authService.resendForgotPassword(
      this.toResendForgotPasswordInput(context, input),
    );
    return accepted(context, result, {
      message: "Password reset instructions have been re-sent.",
    });
  };

  resetPassword = async (context: Context<AppBindings>): Promise<Response> => {
    const input = await parseRequestBody(context, resetPasswordRequestSchema);
    const result = await this.authService.resetPassword(
      this.toResetPasswordInput(context, input),
    );
    return this.json(context, result, {
      message: "Password reset successfully.",
    });
  };

  verifyEmail = async (context: Context<AppBindings>): Promise<Response> => {
    const input = await parseRequestBody(context, verifyEmailRequestSchema);
    const result = await this.authService.verifyEmail(
      this.toVerifyEmailInput(context, input),
    );
    return this.json(context, result, {
      message: "Email verified successfully.",
    });
  };

  resendVerificationEmail = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const input = await parseRequestBody(
      context,
      resendVerificationEmailRequestSchema,
    );
    await this.verifyCaptcha(context, input.captchaToken);
    const result = await this.authService.resendVerificationEmail(
      this.toResendVerificationEmailInput(context, input),
    );
    return accepted(context, result, {
      message: "Verification email has been re-sent.",
    });
  };

  changePassword = async (context: Context<AppBindings>): Promise<Response> => {
    await requireRecentMfaVerification(
      context,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(context, changePasswordRequestSchema);
    const result = await this.authService.changePassword(
      this.toChangePasswordInput(context, input),
    );
    return this.json(context, result, {
      message: "Password changed successfully.",
    });
  };

  unlockLocalLogin = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const input = await parseRequestBody(
      context,
      unlockLocalLoginRequestSchema,
    );
    const result = await this.authService.unlockLocalLogin(
      this.toUnlockLocalLoginInput(input),
    );
    return ok(context, result, {
      message: "Local login unlocked successfully.",
    });
  };

  resendUnlockLocalLogin = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const input = await parseRequestBody(
      context,
      resendUnlockLocalLoginRequestSchema,
    );
    await this.verifyCaptcha(context, input.captchaToken);
    const result = await this.authService.resendUnlockLocalLogin(
      this.toResendUnlockLocalLoginInput(context, input),
    );
    return accepted(context, result, {
      message: "Unlock email has been re-sent.",
    });
  };

  localVerify = async (context: Context<AppBindings>): Promise<Response> => {
    await requireJwtAuth(context);
    const result = await this.authService.localVerify({
      auth: context.get("auth"),
      client: context.get("client"),
    });
    return ok(context, result);
  };

  googleAuthenticate = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const input = await parseRequestBody(
      context,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.authService.googleAuthenticate(
      this.toOAuthAuthenticateInput(context, input),
    );
    return this.json(context, result, {
      message: "Authenticated successfully.",
    });
  };

  microsoftAuthenticate = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const input = await parseRequestBody(
      context,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.authService.microsoftAuthenticate(
      this.toOAuthAuthenticateInput(context, input),
    );
    return this.json(context, result, {
      message: "Authenticated successfully.",
    });
  };

  appleAuthenticate = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const input = await parseRequestBody(
      context,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.authService.appleAuthenticate(
      this.toOAuthAuthenticateInput(context, input),
    );
    return this.json(context, result, {
      message: "Authenticated successfully.",
    });
  };

  linkOAuthProvider = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    await requireJwtAuth(context);
    const input = await parseRequestBody(
      context,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.authService.linkOAuthProvider(
      this.toLinkOAuthProviderInput(context, input),
    );
    return ok(context, result, {
      message: "OAuth provider linked successfully.",
    });
  };

  linkedOAuthProviders = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    await requireJwtAuth(context);
    const result = await this.authService.linkedOAuthProviders({
      userId: context.get("auth").sub,
    });
    return ok(context, result);
  };

  unlinkOAuthProvider = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    await requireJwtAuth(context);
    const result = await this.authService.unlinkOAuthProvider(
      this.toUnlinkOAuthProviderInput(context),
    );
    return ok(context, result, {
      message: "OAuth provider unlinked successfully.",
    });
  };

  refresh = async (context: Context<AppBindings>): Promise<Response> => {
    const input = await parseRequestBody(context, refreshRequestSchema);
    const result = await this.authService.refresh(
      this.toRefreshInput(context, input),
    );
    return this.json(context, result, {
      message: "Session refreshed successfully.",
    });
  };

  logout = async (context: Context<AppBindings>): Promise<Response> => {
    await requireJwtAuth(context);
    const result = await this.authService.logout({
      auth: context.get("auth"),
      client: context.get("client"),
      refreshToken: getCookie(context, REFRESH_TOKEN_COOKIE_NAME),
    });

    deleteCookie(context, REFRESH_TOKEN_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      secure: this.isSecureCookieEnabled(),
      sameSite: "Lax",
    });
    deleteCookie(context, CSRF_TOKEN_COOKIE_NAME, {
      path: "/",
      secure: this.isSecureCookieEnabled(),
      sameSite: "Lax",
    });

    return ok(context, result, {
      message: "Logged out successfully.",
    });
  };

  deviceVerify = async (context: Context<AppBindings>): Promise<Response> => {
    await requireJwtAuth(context);
    const result = await this.authService.deviceVerify({
      auth: context.get("auth"),
      client: context.get("client"),
    });
    return ok(context, result, {
      message: "Device verified successfully.",
    });
  };

  devices = async (context: Context<AppBindings>): Promise<Response> => {
    await requireRecentMfaVerification(
      context,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const result = await this.authService.devices({
      auth: context.get("auth"),
      client: context.get("client"),
    });
    return ok(context, result);
  };

  removeKnownDevice = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    await requireRecentMfaVerification(
      context,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(
      context,
      removeKnownDeviceRequestSchema,
    );
    const result = await this.authService.removeKnownDevice(
      this.toRemoveKnownDeviceInput(context, input),
    );
    return ok(context, result, {
      message: "Known device removed successfully.",
    });
  };

  private json(
    context: Context<AppBindings>,
    body: AuthSessionResult,
    options?: {
      message?: string;
    },
  ): Response {
    const responseBody = this.toAuthResponseBody(context, body);

    if (this.shouldSetRefreshCookie(context)) {
      this.setBrowserSessionCookies(context, body);
    }

    return ok(context, responseBody, options);
  }

  private toLocalAuthenticateInput(
    context: Context<AppBindings>,
    input: LocalAuthenticateRequestBody,
  ): LocalAuthenticateInput {
    return {
      email: input.email,
      password: input.password,
      rememberMe: input.rememberMe,
      client: context.get("client"),
      deviceId: this.resolveDeviceId(context, input.deviceId),
      totpCode: input.totpCode,
    };
  }

  private toLocalSignupInput(
    context: Context<AppBindings>,
    input: LocalSignupRequestBody,
  ): LocalSignupInput {
    return {
      client: context.get("client"),
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      deviceId: this.resolveDeviceId(context, input.deviceId),
    };
  }

  private toOAuthAuthenticateInput(
    context: Context<AppBindings>,
    input: OAuthAuthenticateRequestBody,
  ): OAuthAuthenticateInput {
    return {
      code: input.code,
      codeVerifier: input.codeVerifier,
      idToken: input.idToken,
      nonce: input.nonce,
      rememberMe: input.rememberMe,
      client: context.get("client"),
      firstName: input.firstName,
      lastName: input.lastName,
      deviceId: this.resolveDeviceId(context, input.deviceId),
      totpCode: input.totpCode,
    };
  }

  private toLinkOAuthProviderInput(
    context: Context<AppBindings>,
    input: OAuthAuthenticateRequestBody,
  ): LinkOAuthProviderInput {
    return {
      ...this.toOAuthAuthenticateInput(context, input),
      provider: this.requireOAuthProviderParam(context),
      userId: context.get("auth").sub,
    };
  }

  private toUnlinkOAuthProviderInput(
    context: Context<AppBindings>,
  ): UnlinkOAuthProviderInput {
    return {
      provider: this.requireOAuthProviderParam(context),
      userId: context.get("auth").sub,
    };
  }

  private requireOAuthProviderParam(
    context: Context<AppBindings>,
  ): OAuthProvider {
    const provider = requireSafeRouteParam(context, "provider");

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
    context: Context<AppBindings>,
    deviceId?: string,
  ): string | undefined {
    return deviceId ?? context.get("client").device.id;
  }

  private toVerifyEmailInput(
    context: Context<AppBindings>,
    input: VerifyEmailRequestBody,
  ): VerifyEmailInput {
    return {
      client: context.get("client"),
      email: input.email,
      code: input.code,
      deviceId: this.resolveDeviceId(context, input.deviceId),
    };
  }

  private toResendVerificationEmailInput(
    context: Context<AppBindings>,
    input: ResendVerificationEmailRequestBody,
  ): ResendVerificationEmailInput {
    return {
      client: context.get("client"),
      email: input.email,
      deviceId: this.resolveDeviceId(context),
    };
  }

  private toForgotPasswordInput(
    context: Context<AppBindings>,
    input: ForgotPasswordRequestBody,
  ): ForgotPasswordInput {
    return {
      client: context.get("client"),
      email: input.email,
      deviceId: this.resolveDeviceId(context),
    };
  }

  private toResendForgotPasswordInput(
    context: Context<AppBindings>,
    input: ResendForgotPasswordRequestBody,
  ): ResendForgotPasswordInput {
    return {
      client: context.get("client"),
      email: input.email,
      deviceId: this.resolveDeviceId(context),
    };
  }

  private toRefreshInput(
    context: Context<AppBindings>,
    input: RefreshRequestBody,
  ): RefreshInput {
    return {
      client: context.get("client"),
      refreshToken:
        input.refreshToken ?? getCookie(context, REFRESH_TOKEN_COOKIE_NAME),
    };
  }

  private toResetPasswordInput(
    context: Context<AppBindings>,
    input: ResetPasswordRequestBody,
  ): ResetPasswordInput {
    return {
      client: context.get("client"),
      email: input.email,
      code: input.code,
      newPassword: input.newPassword,
      deviceId: this.resolveDeviceId(context, input.deviceId),
    };
  }

  private toRemoveKnownDeviceInput(
    context: Context<AppBindings>,
    input: RemoveKnownDeviceRequestBody,
  ): RemoveKnownDeviceInput {
    return {
      userId: context.get("auth").sub,
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
    context: Context<AppBindings>,
    input: ResendUnlockLocalLoginRequestBody,
  ): ResendUnlockLocalLoginInput {
    return {
      client: context.get("client"),
      email: input.email,
      deviceId: this.resolveDeviceId(context),
    };
  }

  private toChangePasswordInput(
    context: Context<AppBindings>,
    input: ChangePasswordRequestBody,
  ): ChangePasswordInput {
    return {
      userId: context.get("auth").sub,
      client: context.get("client"),
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      deviceId: context.get("auth").deviceId ?? context.get("client").device.id,
    };
  }

  private toAuthResponseBody(
    context: Context<AppBindings>,
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

    if (!this.shouldSetRefreshCookie(context)) {
      responseBody.refreshToken = result.refreshToken;
    }

    return responseBody;
  }

  private shouldSetRefreshCookie(context: Context<AppBindings>): boolean {
    return this.isBrowserRequest(context);
  }

  private isBrowserRequest(context: Context<AppBindings>): boolean {
    return Boolean(
      context.req.header("origin") ||
        context.req.header("referer") ||
        context.req.header("sec-fetch-site"),
    );
  }

  private isSecureCookieEnabled(): boolean {
    return environment.isProduction();
  }

  private createCsrfToken(): string {
    return randomUUID();
  }

  private setBrowserSessionCookies(
    context: Context<AppBindings>,
    result: AuthSessionResult,
  ): void {
    const secure = this.isSecureCookieEnabled();

    setCookie(context, REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, {
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "Lax",
      maxAge: result.refreshTokenExpiresInSeconds,
    });
    setCookie(context, CSRF_TOKEN_COOKIE_NAME, this.createCsrfToken(), {
      path: "/",
      secure,
      sameSite: "Lax",
      maxAge: result.refreshTokenExpiresInSeconds,
    });
  }
  private async verifyCaptcha(
    context: Context<AppBindings>,
    captchaToken: string,
  ): Promise<void> {
    const result = await this.captchaService.verify({
      token: captchaToken,
      remoteIp: context.get("client").ip,
      idempotencyKey: resolveIdempotencyKey(context),
    });

    if (!result.success || result.failOpen) {
      throw new BadRequestError("Captcha verification failed.", {
        errors: result.errors,
        failOpen: result.failOpen,
      });
    }
  }
}
