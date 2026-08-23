import type { Request, Response } from "express";
import { getOptionalJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { accepted, ok } from "@/configuration/http/responses";
import { CaptchaService } from "@/features/auth/captcha/captcha.service";
import { requireCaptcha } from "@/features/auth/captcha/captcha.guard";
import {
  parseUsernameAvailabilityQuery,
  toForgotUsernameInput,
} from "@/features/auth/auth.request-mappers";
import { UsernameService } from "@/features/auth/username/username.service";
import { forgotUsernameRequestSchema } from "@/features/auth/username/username.model";

export class UsernameController {
  constructor(
    private readonly usernameService: UsernameService,
    private readonly captchaService: CaptchaService,
  ) {}

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
    const result = await this.usernameService.resolveUsernameAvailabilityHint(
      query.username,
      auth?.sub,
    );

    ok(response, result);
  };

  forgotUsername = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(request, forgotUsernameRequestSchema);
    await requireCaptcha(request, this.captchaService, input.captchaToken);
    const result = await this.usernameService.forgotUsername(
      toForgotUsernameInput(request, input),
    );
    accepted(response, result, {
      message: "Username reminder instructions have been accepted.",
    });
  };
}
