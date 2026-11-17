import type { Request, Response } from "express";
import { ok } from "@/configuration/http/responses";
import {
  parseOptionalRequestBody,
  parseRequestBody,
} from "@/configuration/validation/request";
import { writeAuthSessionResponse } from "@/features/auth/auth.response";
import { toPasskeyLoginInput } from "@/features/auth/auth.request-mappers";
import {
  passkeyLoginOptionsRequestSchema,
  passkeyLoginVerifyRequestSchema,
} from "./passkey-login.model";
import type { PasskeyLoginService } from "./passkey-login.service";

/**
 * Signing in with a passkey alone. No captcha: an assertion needs the private
 * key and the user's biometric or PIN, so it cannot be guessed, and the web
 * app's passkey autofill has no moment to show one. The rate limits and
 * detection cover the rest.
 */
export class PasskeyLoginController {
  constructor(private readonly passkeyLoginService: PasskeyLoginService) {}

  beginOptions = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await parseOptionalRequestBody(request, passkeyLoginOptionsRequestSchema);
    const result = await this.passkeyLoginService.beginOptions();

    response.setHeader("cache-control", "no-store");
    ok(response, result);
  };

  verify = async (request: Request, response: Response): Promise<void> => {
    const input = await parseRequestBody(
      request,
      passkeyLoginVerifyRequestSchema,
    );
    const result = await this.passkeyLoginService.authenticate(
      toPasskeyLoginInput(request, input),
    );

    writeAuthSessionResponse(request, response, result, {
      message: "Authenticated successfully.",
    });
  };
}
