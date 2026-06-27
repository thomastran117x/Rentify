import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { ok } from "@/configuration/http/responses";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  beginEnrollmentRequestSchema,
  confirmEnrollmentRequestSchema,
  disableRequestSchema,
} from "./mfa-totp.model";
import type { MfaTotpService } from "./mfa-totp.service";

export class MfaTotpController {
  constructor(private readonly mfaTotpService: MfaTotpService) {}

  getStatus = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    const enabled = await this.mfaTotpService.isEnabled(auth.sub);
    return ok(context, { enabled });
  };

  beginEnrollment = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    const input = await parseRequestBody(context, beginEnrollmentRequestSchema);
    const accountName = input.accountName ?? auth.email ?? auth.sub;
    const result = await this.mfaTotpService.beginEnrollment(auth.sub, accountName);
    return ok(context, result);
  };

  confirmEnrollment = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    const input = await parseRequestBody(context, confirmEnrollmentRequestSchema);
    await this.mfaTotpService.confirmEnrollment(auth.sub, input.code);
    return ok(context, { confirmed: true as const }, {
      message: "Authenticator app enabled.",
    });
  };

  disable = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    const input = await parseRequestBody(context, disableRequestSchema);
    // Verify the active TOTP code before removing the second factor — a stolen
    // session alone is not sufficient to downgrade account security.
    await this.mfaTotpService.verifyCode(auth.sub, input.code);
    await this.mfaTotpService.disable(auth.sub);
    return ok(context, { disabled: true as const }, {
      message: "Authenticator app disabled.",
    });
  };

  cancelEnrollment = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    await this.mfaTotpService.cancelEnrollment(auth.sub);
    return ok(context, { cancelled: true as const });
  };
}
