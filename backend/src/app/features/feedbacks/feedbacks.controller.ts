import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
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

class FeedbacksController {
  constructor(
    private readonly feedbacksService: FeedbacksService,
    private readonly captchaService: CaptchaService,
  ) {}

  create = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await getOptionalJwtAuth(context);
    const body = await parseRequestBody(
      context,
      createAppFeedbackRequestSchema,
    );

    if (!auth) {
      await this.verifyCaptcha(context, body.captchaToken);
    }

    const result = await this.feedbacksService.create({
      userId: auth?.sub,
      name: body.name,
      email: body.email,
      category: body.category,
      message: body.message,
    });

    return created(context, result, {
      message: "Feedback submitted successfully.",
    });
  };

  private async verifyCaptcha(
    context: Context<AppBindings>,
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

export { FeedbacksController };
export default FeedbacksController;
