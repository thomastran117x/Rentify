import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import {
  getOptionalJwtAuth,
  requireJwtAuth,
} from "@/configuration/middlewares/jwt-middleware";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import type { AuthPrincipal } from "@/features/auth/auth.principal";
import {
  createOrganizationInviteRequestSchema,
  createOrganizationRequestSchema,
  organizationInviteTokenSchema,
  organizationResourceIdSchema,
  setActiveOrganizationRequestSchema,
  updateOrganizationMemberRequestSchema,
  updateOrganizationRequestSchema,
} from "@/features/organizations/organizations.model";
import {
  listOrganizationAuditQuerySchema,
  organizationAuditIdSchema,
} from "@/features/organizations/organization-audit.model";
import { OrganizationsService } from "@/features/organizations/organizations.service";

export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  listMine = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.listMine(auth.sub);
    return ok(context, result);
  };

  create = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      createOrganizationRequestSchema,
    );
    const result = await this.organizationsService.createOrganization({
      actorUserId: auth.sub,
      ...body,
    });
    return created(context, result, {
      message: "Organization created successfully.",
    });
  };

  setActive = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      setActiveOrganizationRequestSchema,
    );
    const result = await this.organizationsService.setActiveOrganization({
      userId: auth.sub,
      organizationId: body.organizationId,
    });
    return ok(context, result, {
      message: "Active organization updated successfully.",
    });
  };

  getById = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.getById(
      this.requireOrganizationId(context),
      auth.sub,
    );
    return ok(context, result);
  };

  listAudit = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const query = listOrganizationAuditQuerySchema.parse(context.req.query());
    const result = await this.organizationsService.listAudit({
      ...query,
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
    });
    return ok(context, result, { meta: paginationMeta(result) });
  };

  restoreAuditEntry = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.restoreVersion({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      auditId: this.requireRouteValue(
        context,
        "auditId",
        organizationAuditIdSchema,
        "Route parameter validation failed.",
      ),
    });
    return ok(context, result, {
      message: "Organization version restored successfully.",
    });
  };
  update = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      updateOrganizationRequestSchema,
    );
    const result = await this.organizationsService.update({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      ...body,
    });
    return ok(context, result, {
      message: "Organization updated successfully.",
    });
  };

  createInvitation = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      createOrganizationInviteRequestSchema,
    );
    const result = await this.organizationsService.createInvitation({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      email: body.email,
      role: body.role,
    });
    return created(context, result, {
      message: "Organization invitation created successfully.",
    });
  };

  revokeInvitation = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.revokeInvitation({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      invitationId: this.requireResourceId(context, "inviteId"),
    });
    return ok(context, result, {
      message: "Organization invitation revoked successfully.",
    });
  };

  updateMemberRole = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      updateOrganizationMemberRequestSchema,
    );
    const result = await this.organizationsService.updateMemberRole({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      membershipId: this.requireResourceId(context, "memberId"),
      role: body.role,
    });
    return ok(context, result, {
      message: "Organization member updated successfully.",
    });
  };

  removeMember = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.removeMember({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      membershipId: this.requireResourceId(context, "memberId"),
    });
    return ok(context, result, {
      message: "Organization member removed successfully.",
    });
  };

  previewInvitation = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.getOptionalAuth(context);
    const result = await this.organizationsService.previewInvitation({
      token: this.requireInviteToken(context),
      userId: auth?.sub,
    });
    return ok(context, result);
  };

  acceptInvitation = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.acceptInvitation({
      token: this.requireInviteToken(context),
      userId: auth.sub,
    });
    return ok(context, result, {
      message: "Organization invitation accepted successfully.",
    });
  };

  private requireOrganizationId(context: Context<AppBindings>): string {
    return this.requireResourceId(context, "id");
  }

  private requireInviteToken(context: Context<AppBindings>): string {
    return this.requireRouteValue(
      context,
      "token",
      organizationInviteTokenSchema,
      "Route parameter validation failed.",
    );
  }

  private requireResourceId(
    context: Context<AppBindings>,
    name: string,
  ): string {
    return this.requireRouteValue(
      context,
      name,
      organizationResourceIdSchema,
      "Route parameter validation failed.",
    );
  }

  private requireRouteValue<TValue extends string>(
    context: Context<AppBindings>,
    name: string,
    schema: { parse: (value: string) => TValue },
    message: string,
  ): TValue {
    const value = requireSafeRouteParam(context, name);

    try {
      return schema.parse(value);
    } catch (error) {
      if ("issues" in (error as object)) {
        const issues =
          (error as { issues?: Array<{ message: string }> }).issues ?? [];

        throw new RequestValidationError(
          message,
          issues.map((issue) => ({
            path: name,
            message: issue.message,
          })),
        );
      }

      throw error;
    }
  }

  private async requireAuth(
    context: Context<AppBindings>,
  ): Promise<AuthPrincipal> {
    return requireJwtAuth(context);
  }

  private async getOptionalAuth(
    context: Context<AppBindings>,
  ): Promise<AuthPrincipal | null> {
    return getOptionalJwtAuth(context);
  }
}
