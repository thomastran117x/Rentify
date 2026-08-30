import type { Request, Response } from "express";
import { created } from "@/configuration/http/responses";
import { getOptionalJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { resolveIdempotencyKey } from "@/configuration/middlewares/idempotency.middleware";
import {
  parseRequestBody,
  RequestValidationError,
} from "@/configuration/validation/request";
import BadRequestError from "@/errors/http/bad-request.error";
import type { CaptchaService } from "@/features/auth/captcha/captcha.service";
import type { FeedbacksService } from "@/features/feedbacks/feedbacks.service";
import { createAppFeedbackRequestSchema } from "@/features/feedbacks/feedbacks.model";
import { asOptionalUuid, asUuid } from "@/configuration/validation/uuid";

class FeedbacksController {
  constructor(
    private readonly feedbacksService: FeedbacksService,
    private readonly captchaService: CaptchaService,
  ) {}

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await getOptionalJwtAuth(request);
    const body = await parseRequestBody(
      request,
      createAppFeedbackRequestSchema,
    );

    if (!auth) {
      await this.verifyCaptcha(request, body.captchaToken);
    }

    const result = await this.feedbacksService.create({
      userId: asOptionalUuid(auth?.sub),
      name: body.name,
      email: body.email,
      category: body.category,
      message: body.message,
    });

    created(response, result, {
      message: "Feedback submitted successfully.",
    });
  };

  private async verifyCaptcha(
    request: Request,
    captchaToken?: string,
  ): Promise<void> {
    if (!captchaToken) {
      throw new RequestValidationError("Request body validation failed.", [
        {
          path: "captchaToken",
          message: "Captcha token is required.",
        },
      ]);
    }

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

export { FeedbacksController };
export default FeedbacksController;
