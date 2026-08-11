import type { Request } from "express";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { MfaVerificationScope } from "./mfa-verification.model";
import type { MfaVerificationService } from "./mfa-verification.service";

export async function requireRecentMfaVerification(
  request: Request,
  mfaVerificationService: MfaVerificationService,
  scope: MfaVerificationScope,
): Promise<JwtAuthPrincipal> {
  const auth = await requireSessionAuth(request);

  if (!auth.sessionId) {
    throw new UnauthorizedError("Session is no longer valid.");
  }

  await mfaVerificationService.assertRecentVerification({
    userId: auth.sub,
    sessionId: auth.sessionId,
    scope,
    client: request.client,
  });

  return auth;
}
