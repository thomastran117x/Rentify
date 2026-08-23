import type { Request, Response } from "express";
import { parseRequestBody } from "@/configuration/validation/request";
import { accepted, ok } from "@/configuration/http/responses";
import { CaptchaService } from "@/features/auth/captcha/captcha.service";
import { requireCaptcha } from "@/features/auth/captcha/captcha.guard";
import {
  toResendUnlockLocalLoginInput,
  toUnlockLocalLoginInput,
} from "@/features/auth/auth.request-mappers";
import { LoginLockoutService } from "@/features/auth/lockout/login-lockout.service";
import {
  resendUnlockLocalLoginRequestSchema,
  unlockLocalLoginRequestSchema,
} from "@/features/auth/lockout/login-lockout.model";

export class LoginLockoutController {
  constructor(
    private readonly loginLockoutService: LoginLockoutService,
    private readonly captchaService: CaptchaService,
  ) {}

  unlockLocalLogin = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(request, unlockLocalLoginRequestSchema);
    const result = await this.loginLockoutService.unlockLocalLogin(
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
    const result = await this.loginLockoutService.resendUnlockLocalLogin(
      toResendUnlockLocalLoginInput(request, input),
    );
    accepted(response, result, {
      message: "Unlock email has been re-sent.",
    });
  };
}
