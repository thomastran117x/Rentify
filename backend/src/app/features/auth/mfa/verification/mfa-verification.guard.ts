import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { MfaVerificationScope } from "./mfa-verification.model";
import type { MfaVerificationService } from "./mfa-verification.service";

export async function requireRecentMfaVerification(
  context: Context<AppBindings>,
  mfaVerificationService: MfaVerificationService,
  scope: MfaVerificationScope,
): Promise<JwtAuthPrincipal> {
  const auth = await requireSessionAuth(context);

  if (!auth.sessionId) {
    throw new UnauthorizedError("Session is no longer valid.");
  }

  await mfaVerificationService.assertRecentVerification({
    userId: auth.sub,
    sessionId: auth.sessionId,
    scope,
    client: context.get("client"),
  });

  return auth;
}
