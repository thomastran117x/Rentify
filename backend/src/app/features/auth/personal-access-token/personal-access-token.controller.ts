import type { Request, Response } from "express";
import { created, ok } from "@/configuration/http/responses";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import { requireUuidRouteParam } from "@/configuration/validation/input-sanitization";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  createPersonalAccessTokenRequestSchema,
  type CreatePersonalAccessTokenRequestBody,
  type CreatePersonalAccessTokenInput,
} from "./personal-access-token.model";
import { PersonalAccessTokenService } from "./personal-access-token.service";
import { asUuid } from "@/configuration/validation/uuid";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";

export class PersonalAccessTokenController {
  constructor(
    private readonly personalAccessTokenService: PersonalAccessTokenService,
  ) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const result = await this.personalAccessTokenService.listForUser(auth.sub);
    ok(response, result);
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const input = await parseRequestBody(
      request,
      createPersonalAccessTokenRequestSchema,
    );
    const result = await this.personalAccessTokenService.create(
      this.toCreateInput(request, auth, input),
    );
    created(response, result, {
      message: "Personal access token created successfully.",
    });
  };

  revoke = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const result = await this.personalAccessTokenService.revoke({
      userId: asUuid(auth.sub),
      tokenId: requireUuidRouteParam(request, "id"),
      sessionId: auth.sessionId,
      audit: toAuthAuditContext(request, auth.deviceId),
    });
    ok(response, result, {
      message: "Personal access token revoked successfully.",
    });
  };

  private toCreateInput(
    request: Request,
    auth: JwtAuthPrincipal,
    input: CreatePersonalAccessTokenRequestBody,
  ): CreatePersonalAccessTokenInput {
    return {
      userId: asUuid(auth.sub),
      name: input.name,
      scopes: input.scopes as CreatePersonalAccessTokenInput["scopes"],
      expiresAt: input.expiresAt,
      expiresInDays: input.expiresInDays,
      sessionId: auth.sessionId,
      audit: toAuthAuditContext(request, auth.deviceId),
    };
  }
}
