import type { Request } from "express";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import MfaVerificationRequiredError from "@/errors/http/mfa-verification-required.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { MfaVerificationScope } from "./mfa-verification.model";
import type { MfaVerificationService } from "./mfa-verification.service";
import { asUuid } from "@/configuration/validation/uuid";

export async function requireRecentMfaVerification(
  request: Request,
  mfaVerificationService: MfaVerificationService,
  scope: MfaVerificationScope,
): Promise<JwtAuthPrincipal> {
  return requireRecentMfaVerificationForAnyScope(
    request,
    mfaVerificationService,
    [scope],
  );
}

/**
 * For an action reached from more than one flow, each with its own proof. A
 * proof from any listed scope is enough; with none, the error describes the
 * last scope, so list the one a client should ask for last.
 */
export async function requireRecentMfaVerificationForAnyScope(
  request: Request,
  mfaVerificationService: MfaVerificationService,
  scopes: readonly [MfaVerificationScope, ...MfaVerificationScope[]],
): Promise<JwtAuthPrincipal> {
  const auth = await requireSessionAuth(request);

  if (!auth.sessionId) {
    throw new UnauthorizedError("Session is no longer valid.");
  }

  let missingProof: MfaVerificationRequiredError | undefined;

  for (const scope of scopes) {
    try {
      await mfaVerificationService.assertRecentVerification({
        userId: asUuid(auth.sub),
        sessionId: auth.sessionId,
        scope,
        client: request.client,
      });
      return auth;
    } catch (error) {
      if (!(error instanceof MfaVerificationRequiredError)) {
        throw error;
      }
      missingProof = error;
    }
  }

  throw missingProof;
}
