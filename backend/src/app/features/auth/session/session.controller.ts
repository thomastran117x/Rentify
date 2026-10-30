import type { Request, Response } from "express";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { ok } from "@/configuration/http/responses";
import { readRefreshTokenCookie } from "@/features/auth/auth.cookies";
import {
  clearBrowserSessionCookies,
  writeAuthSessionResponse,
} from "@/features/auth/auth.response";
import { toRefreshInput } from "@/features/auth/auth.request-mappers";
import { AuthSessionService } from "@/features/auth/session/session.service";
import { refreshRequestSchema } from "@/features/auth/session/session.model";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";

export class AuthSessionController {
  constructor(private readonly authSessionService: AuthSessionService) {}

  localVerify = async (request: Request, response: Response): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.authSessionService.localVerify({
      auth: request.auth,
      client: request.client,
    });
    ok(response, result);
  };

  refresh = async (request: Request, response: Response): Promise<void> => {
    const input = await parseRequestBody(request, refreshRequestSchema);
    const result = await this.authSessionService.refresh(
      toRefreshInput(request, input),
    );
    writeAuthSessionResponse(request, response, result, {
      message: "Session refreshed successfully.",
    });
  };

  logout = async (request: Request, response: Response): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.authSessionService.logout({
      auth: request.auth,
      client: request.client,
      refreshToken: readRefreshTokenCookie(request),
      audit: toAuthAuditContext(request, request.auth.deviceId),
    });

    clearBrowserSessionCookies(response);

    ok(response, result, {
      message: "Logged out successfully.",
    });
  };
}
