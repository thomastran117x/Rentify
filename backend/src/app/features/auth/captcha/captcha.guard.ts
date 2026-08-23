import type { Request } from "express";
import { resolveIdempotencyKey } from "@/configuration/middlewares/idempotency.middleware";
import BadRequestError from "@/errors/http/bad-request.error";
import type { CaptchaService } from "@/features/auth/captcha/captcha.service";

/**
 * Fails closed: a `failOpen` result means the provider could not be reached, and
 * an unattested request is rejected rather than waved through.
 */
export async function requireCaptcha(
  request: Request,
  captchaService: CaptchaService,
  captchaToken: string,
): Promise<void> {
  const result = await captchaService.verify({
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
