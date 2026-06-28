import type { Context } from "hono";
import { ZodError } from "zod";
import type { AppBindings } from "@/configuration/http/bindings";
import { ok } from "@/configuration/http/responses";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import { RequestValidationError, parseRequestBody } from "@/configuration/validation/request";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import {
  mfaVerificationChallengeRequestSchema,
  mfaVerificationConfirmRequestSchema,
  mfaVerificationScopeSchema,
} from "./mfa-verification.model";
import type { MfaVerificationService } from "./mfa-verification.service";

export class MfaVerificationController {
  constructor(private readonly mfaVerificationService: MfaVerificationService) {}

  getOptions = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    const scope = this.parseScopeQuery(context);
    const sessionId = this.requireSessionId(auth.sessionId);
    const result = await this.mfaVerificationService.getOptions({
      userId: auth.sub,
      sessionId,
      scope,
    });
    return ok(context, result);
  };

  issueChallenge = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    const sessionId = this.requireSessionId(auth.sessionId);
    const input = await parseRequestBody(
      context,
      mfaVerificationChallengeRequestSchema,
    );
    const result = await this.mfaVerificationService.issueChallenge({
      userId: auth.sub,
      sessionId,
      scope: input.scope,
      factor: input.factor,
      client: context.get("client"),
    });
    return ok(context, result);
  };

  confirmChallenge = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    const sessionId = this.requireSessionId(auth.sessionId);
    const input = await parseRequestBody(
      context,
      mfaVerificationConfirmRequestSchema,
    );
    const result = await this.mfaVerificationService.confirmChallenge({
      userId: auth.sub,
      sessionId,
      scope: input.scope,
      factor: input.factor,
      code: input.code,
      client: context.get("client"),
    });
    return ok(context, result);
  };

  previewCurrentEmailOtp = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    const scope = this.parseScopeQuery(context);
    const sessionId = this.requireSessionId(auth.sessionId);
    const result = await this.mfaVerificationService.previewCurrentEmailOtp({
      userId: auth.sub,
      sessionId,
      scope,
    });
    return ok(context, result);
  };

  private parseScopeQuery(context: Context<AppBindings>) {
    try {
      return mfaVerificationScopeSchema.parse(
        context.req.query("scope")?.trim() ?? "",
      );
    } catch (error) {
      if (error instanceof ZodError) {
        throw new RequestValidationError(
          "Request query validation failed.",
          error.issues.map((issue) => ({
            path: issue.path.join(".") || "scope",
            message: issue.message,
          })),
        );
      }

      throw error;
    }
  }

  private requireSessionId(sessionId?: string): string {
    if (!sessionId) {
      throw new UnauthorizedError("Session is no longer valid.");
    }

    return sessionId;
  }
}
