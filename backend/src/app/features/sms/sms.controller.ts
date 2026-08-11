import type { Request, Response } from "express";
import { readRawBody } from "@/configuration/http/request";
import { ok } from "@/configuration/http/responses";
import type { SmsService } from "@/features/sms/sms.service";

export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  webhook = async (request: Request, response: Response): Promise<void> => {
    const rawBody = readRawBody(request);
    await this.smsService.processWebhook(rawBody, {
      signatureEd25519: request.get("telnyx-signature-ed25519"),
      timestamp: request.get("telnyx-timestamp"),
    });

    ok(
      response,
      { ok: true },
      {
        message: "SMS webhook processed successfully.",
      },
    );
  };
}
