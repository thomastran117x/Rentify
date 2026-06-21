import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { ok } from "@/configuration/http/responses";
import type { SmsService } from "@/features/sms/sms.service";

export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  webhook = async (context: Context<AppBindings>): Promise<Response> => {
    const rawBody = await context.req.text();
    await this.smsService.processWebhook(rawBody, {
      signatureEd25519: context.req.header("telnyx-signature-ed25519"),
      timestamp: context.req.header("telnyx-timestamp"),
    });

    return ok(
      context,
      { ok: true },
      {
        message: "SMS webhook processed successfully.",
      },
    );
  };
}