import type { Request, Response } from "express";
import { ok } from "@/configuration/http/responses";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import { requireUuidRouteParam } from "@/configuration/validation/input-sanitization";
import { parseRequestBody } from "@/configuration/validation/request";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import ForbiddenError from "@/errors/http/forbidden.error";
import {
  accountStatusChangeBodySchema,
  type AccountStatusChangeInput,
  type AccountStatusChangeResult,
} from "@/features/auth/account-status/account-status.model";
import type { AccountStatusService } from "@/features/auth/account-status/account-status.service";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";
import { requireMinimumRole } from "@/features/auth/authorization";

type StatusAction = (
  userId: Uuid,
  input: AccountStatusChangeInput,
) => Promise<AccountStatusChangeResult>;

/**
 * Admin-only lock, suspend and reinstate. The role is checked before the route
 * parameter or body is looked at, so a non-admin learns nothing from a
 * validation error. Personal access tokens are rejected, and an admin cannot
 * change their own status: locking yourself out is never what was meant, and
 * reinstating yourself would let a suspended admin undo their own suspension.
 */
export class AccountStatusAdminController {
  constructor(private readonly accountStatusService: AccountStatusService) {}

  lock = async (request: Request, response: Response): Promise<void> => {
    await this.handle(request, response, (userId, input) =>
      this.accountStatusService.lock(userId, input),
    );
  };

  suspend = async (request: Request, response: Response): Promise<void> => {
    await this.handle(request, response, (userId, input) =>
      this.accountStatusService.suspend(userId, input),
    );
  };

  reinstate = async (request: Request, response: Response): Promise<void> => {
    await this.handle(request, response, (userId, input) =>
      this.accountStatusService.reinstate(userId, input),
    );
  };

  private async handle(
    request: Request,
    response: Response,
    action: StatusAction,
  ): Promise<void> {
    const auth = await requireSessionAuth(request);
    requireMinimumRole(auth, "admin");
    const adminId = asUuid(auth.sub);
    const userId = requireUuidRouteParam(request, "id");

    // UUIDs are accepted in either case and MySQL compares IDs without
    // regard to case, so the self check must not depend on the casing sent.
    if (userId.toLowerCase() === adminId.toLowerCase()) {
      throw new ForbiddenError("You cannot change your own account status.");
    }

    const { reason } = await parseRequestBody(
      request,
      accountStatusChangeBodySchema,
    );
    const result = await action(userId, {
      reason,
      source: "admin",
      actorUserId: adminId,
      context: toAuthAuditContext(request),
    });

    ok(response, result);
  }
}
