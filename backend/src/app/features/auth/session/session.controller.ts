import type { Request, Response } from "express";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { requireUuidRouteParam } from "@/configuration/validation/input-sanitization";
import { ok } from "@/configuration/http/responses";
import { readRefreshTokenCookie } from "@/features/auth/auth.cookies";
import {
  clearBrowserSessionCookies,
  writeAuthSessionResponse,
} from "@/features/auth/auth.response";
import { toRefreshInput } from "@/features/auth/auth.request-mappers";
import { AuthSessionService } from "@/features/auth/session/session.service";
import {
  refreshRequestSchema,
  revokeSessionsRequestSchema,
} from "@/features/auth/session/session.model";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import { requireRecentMfaVerification } from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";

export class AuthSessionController {
  constructor(
    private readonly authSessionService: AuthSessionService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

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

  sessions = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const result = await this.authSessionService.listSessions(auth);
    ok(response, result);
  };

  revokeSession = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const result = await this.authSessionService.revokeManagedSession({
      auth,
      sessionId: requireUuidRouteParam(request, "id"),
      refreshToken: readRefreshTokenCookie(request),
      audit: toAuthAuditContext(request, auth.deviceId),
    });

    if (result.current) {
      clearBrowserSessionCookies(response);
    }

    ok(response, result, { message: "Session signed out successfully." });
  };

  revokeSessions = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(request, revokeSessionsRequestSchema);
    const result = await this.authSessionService.revokeManagedSessions({
      auth,
      scope: input.scope,
      audit: toAuthAuditContext(request, auth.deviceId),
    });

    if (result.scope === "all") {
      clearBrowserSessionCookies(response);
    }

    ok(response, result, { message: "Sessions signed out successfully." });
  };
}
