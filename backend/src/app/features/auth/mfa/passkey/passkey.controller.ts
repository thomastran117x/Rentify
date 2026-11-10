import type { Request, Response } from "express";
import { created, noContent, ok } from "@/configuration/http/responses";
import {
  parseOptionalRequestBody,
  parseRequestBody,
} from "@/configuration/validation/request";
import { requireUuidRouteParam } from "@/configuration/validation/input-sanitization";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import { requireRecentMfaVerification } from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import {
  passkeyRegistrationOptionsRequestSchema,
  passkeyRegistrationVerifyRequestSchema,
  passkeyRenameRequestSchema,
  type PasskeyRegistrationCredential,
} from "./passkey.model";
import type { PasskeyActor, PasskeyService } from "./passkey.service";

/**
 * Passkey management. Every route needs a recent `mfa-management` proof,
 * listing included: the list says which authenticators can stand in for the
 * account's second factor.
 */
export class PasskeyController {
  constructor(
    private readonly passkeyService: PasskeyService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

  beginRegistration = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { actor } = await this.requireActor(request);
    await parseOptionalRequestBody(
      request,
      passkeyRegistrationOptionsRequestSchema,
    );

    response.setHeader("cache-control", "no-store");
    ok(response, await this.passkeyService.beginRegistration(actor));
  };

  finishRegistration = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { actor } = await this.requireActor(request);
    const input = await parseRequestBody(
      request,
      passkeyRegistrationVerifyRequestSchema,
    );
    const result = await this.passkeyService.finishRegistration({
      ...actor,
      // The schema's output is the library's input with stricter checks; the
      // library verifies the rest.
      credential: input.credential as PasskeyRegistrationCredential,
      name: input.name,
    });

    // It may carry the account's first recovery codes.
    response.setHeader("cache-control", "no-store");
    created(response, result, { message: "Passkey added." });
  };

  list = async (request: Request, response: Response): Promise<void> => {
    const { actor } = await this.requireActor(request);

    ok(response, await this.passkeyService.list(actor.userId));
  };

  rename = async (request: Request, response: Response): Promise<void> => {
    const { actor } = await this.requireActor(request);
    const id = requireUuidRouteParam(request, "id");
    const input = await parseRequestBody(request, passkeyRenameRequestSchema);
    const passkey = await this.passkeyService.rename({
      ...actor,
      id,
      name: input.name,
    });

    ok(response, { passkey }, { message: "Passkey renamed." });
  };

  remove = async (request: Request, response: Response): Promise<void> => {
    const { actor, auth } = await this.requireActor(request);
    const id = requireUuidRouteParam(request, "id");

    await this.passkeyService.remove({ ...actor, auth, id });
    noContent(response);
  };

  private async requireActor(
    request: Request,
  ): Promise<{ actor: PasskeyActor; auth: JwtAuthPrincipal }> {
    const auth: JwtAuthPrincipal = await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );

    // The guard already refuses a principal without a session; this narrows
    // the type for the challenge binding.
    if (!auth.sessionId) {
      throw new UnauthorizedError("Session is no longer valid.");
    }

    return {
      auth,
      actor: {
        userId: auth.sub,
        sessionId: auth.sessionId,
        context: toAuthAuditContext(request, auth.deviceId),
      },
    };
  }
}
