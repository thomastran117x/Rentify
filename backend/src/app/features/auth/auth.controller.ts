import type { Request, Response } from "express";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { accepted, ok } from "@/configuration/http/responses";
import { AuthService } from "@/features/auth/auth.service";
import { CaptchaService } from "@/features/auth/captcha/captcha.service";
import { requireCaptcha } from "@/features/auth/captcha/captcha.guard";
import { writeAuthSessionResponse } from "@/features/auth/auth.response";
import {
  toLocalAuthenticateInput,
  toLocalSignupInput,
  toResendVerificationEmailInput,
  toVerifyEmailInput,
} from "@/features/auth/auth.request-mappers";
import {
  localAuthenticateRequestSchema,
  localSignupRequestSchema,
  resendVerificationEmailRequestSchema,
  verifyEmailRequestSchema,
} from "@/features/auth/auth.model";

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
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
}
