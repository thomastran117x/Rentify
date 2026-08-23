import type { Request, Response } from "express";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { ok } from "@/configuration/http/responses";
import { writeAuthSessionResponse } from "@/features/auth/auth.response";
import {
  toLinkOAuthProviderInput,
  toOAuthAuthenticateInput,
  toUnlinkOAuthProviderInput,
} from "@/features/auth/auth.request-mappers";
import { OAuthAccountsService } from "@/features/auth/oauth/oauth-accounts.service";
import { oauthAuthenticateRequestSchema } from "@/features/auth/oauth/oauth-accounts.model";

export class OAuthController {
  constructor(
    private readonly oauthAccountsService: OAuthAccountsService,
  ) {}

  googleAuthenticate = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.oauthAccountsService.googleAuthenticate(
      toOAuthAuthenticateInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Authenticated successfully.",
    });
  };

  microsoftAuthenticate = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.oauthAccountsService.microsoftAuthenticate(
      toOAuthAuthenticateInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Authenticated successfully.",
    });
  };

  appleAuthenticate = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = await parseRequestBody(
      request,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.oauthAccountsService.appleAuthenticate(
      toOAuthAuthenticateInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Authenticated successfully.",
    });
  };

  linkOAuthProvider = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireJwtAuth(request);
    const input = await parseRequestBody(
      request,
      oauthAuthenticateRequestSchema,
    );
    const result = await this.oauthAccountsService.linkOAuthProvider(
      toLinkOAuthProviderInput(request, input),
    );
    ok(response, result, {
      message: "OAuth provider linked successfully.",
    });
  };

  linkedOAuthProviders = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.oauthAccountsService.linkedOAuthProviders({
      userId: request.auth.sub,
    });
    ok(response, result);
  };

  unlinkOAuthProvider = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.oauthAccountsService.unlinkOAuthProvider(
      toUnlinkOAuthProviderInput(request),
    );
    ok(response, result, {
      message: "OAuth provider unlinked successfully.",
    });
  };
}
