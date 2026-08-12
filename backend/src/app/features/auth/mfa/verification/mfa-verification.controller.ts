import type { Request, Response } from "express";
import { getQuery } from "@/configuration/http/request";
import { ZodError } from "zod";
import { ok } from "@/configuration/http/responses";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import {
  mfaVerificationChallengeRequestSchema,
  mfaVerificationConfirmRequestSchema,
  mfaVerificationScopeSchema,
} from "./mfa-verification.model";
import type { MfaVerificationService } from "./mfa-verification.service";

export class MfaVerificationController {
  constructor(
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

  getOptions = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const scope = this.parseScopeQuery(request);
    const sessionId = this.requireSessionId(auth.sessionId);
    const result = await this.mfaVerificationService.getOptions({
      userId: auth.sub,
      sessionId,
      scope,
    });
    ok(response, result);
  };

  issueChallenge = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const sessionId = this.requireSessionId(auth.sessionId);
    const input = await parseRequestBody(
      request,
      mfaVerificationChallengeRequestSchema,
    );
    const result = await this.mfaVerificationService.issueChallenge({
      userId: auth.sub,
      sessionId,
      scope: input.scope,
      factor: input.factor,
      client: request.client,
    });
    ok(response, result);
  };

  confirmChallenge = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const sessionId = this.requireSessionId(auth.sessionId);
    const input = await parseRequestBody(
      request,
      mfaVerificationConfirmRequestSchema,
    );
    const result = await this.mfaVerificationService.confirmChallenge({
      userId: auth.sub,
      sessionId,
      scope: input.scope,
      factor: input.factor,
      code: input.code,
      client: request.client,
    });
    ok(response, result);
  };

  previewCurrentEmailOtp = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const scope = this.parseScopeQuery(request);
    const sessionId = this.requireSessionId(auth.sessionId);
    const result = await this.mfaVerificationService.previewCurrentEmailOtp({
      userId: auth.sub,
      sessionId,
      scope,
    });
    ok(response, result);
  };

  private parseScopeQuery(request: Request) {
    try {
      return mfaVerificationScopeSchema.parse(
        getQuery(request).scope?.trim() ?? "",
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
