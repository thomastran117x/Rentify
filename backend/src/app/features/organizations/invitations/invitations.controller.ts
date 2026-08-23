import type { Request, Response } from "express";
import { created, ok } from "@/configuration/http/responses";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  getOptionalAuth,
  requireAuth,
  requireInviteToken,
  requireOrganizationId,
  requireResourceId,
} from "@/features/organizations/organizations.request-helpers";
import { createOrganizationInviteRequestSchema } from "@/features/organizations/invitations/invitations.model";
import { OrganizationInvitationsService } from "@/features/organizations/invitations/invitations.service";

export class OrganizationInvitationsController {
  constructor(
    private readonly invitationsService: OrganizationInvitationsService,
  ) {}

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(
      request,
      createOrganizationInviteRequestSchema,
    );
    const result = await this.invitationsService.createInvitation({
      organizationId: requireOrganizationId(request),
      actorUserId: auth.sub,
      email: body.email,
      role: body.role,
    });
    created(response, result, {
      message: "Organization invitation created successfully.",
    });
  };

  revoke = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.invitationsService.revokeInvitation({
      organizationId: requireOrganizationId(request),
      actorUserId: auth.sub,
      invitationId: requireResourceId(request, "inviteId"),
    });
    ok(response, result, {
      message: "Organization invitation revoked successfully.",
    });
  };

  preview = async (request: Request, response: Response): Promise<void> => {
    const auth = await getOptionalAuth(request);
    const result = await this.invitationsService.previewInvitation({
      token: requireInviteToken(request),
      userId: auth?.sub,
    });
    ok(response, result);
  };

  accept = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.invitationsService.acceptInvitation({
      token: requireInviteToken(request),
      userId: auth.sub,
    });
    ok(response, result, {
      message: "Organization invitation accepted successfully.",
    });
  };
}
