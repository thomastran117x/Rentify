import type { Request, Response } from "express";
import { ok } from "@/configuration/http/responses";
import { parseRequestBody } from "@/configuration/validation/request";
import { writeAuthSessionResponse } from "@/features/auth/auth.response";
import {
  toBeginLoginPasskeyInput,
  toCompleteLoginMfaInput,
} from "@/features/auth/auth.request-mappers";
import {
  loginMfaPasskeyOptionsRequestSchema,
  loginMfaRequestSchema,
} from "@/features/auth/mfa/login/login-mfa.model";
import type { LoginMfaService } from "@/features/auth/mfa/login/login-mfa.service";

export class LoginMfaController {
  constructor(private readonly loginMfaService: LoginMfaService) {}

  completeLoginMfa = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(request, loginMfaRequestSchema);
    const result = await this.loginMfaService.completeLoginMfa(
      toCompleteLoginMfaInput(request, input),
    );

    writeAuthSessionResponse(request, response, result, {
      message: "Authenticated successfully.",
    });
  };

  /** Request options for finishing a pending sign-in with a passkey. */
  beginPasskey = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      loginMfaPasskeyOptionsRequestSchema,
    );
    const result = await this.loginMfaService.beginPasskey(
      toBeginLoginPasskeyInput(request, input),
    );

    response.setHeader("cache-control", "no-store");
    ok(response, result);
  };
}
