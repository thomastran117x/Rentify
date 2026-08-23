import type { Request, Response } from "express";
import { ok } from "@/configuration/http/responses";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  requireAuth,
  requireOrganizationId,
  requireResourceId,
} from "@/features/organizations/organizations.request-helpers";
import {
  setActiveOrganizationRequestSchema,
  updateOrganizationMemberRequestSchema,
} from "@/features/organizations/members/members.model";
import { OrganizationMembersService } from "@/features/organizations/members/members.service";

export class OrganizationMembersController {
  constructor(private readonly membersService: OrganizationMembersService) {}

  listMine = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.membersService.listMine(auth.sub);
    ok(response, result);
  };

  setActive = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(
      request,
      setActiveOrganizationRequestSchema,
    );
    const result = await this.membersService.setActiveOrganization({
      userId: auth.sub,
      organizationId: body.organizationId,
    });
    ok(response, result, {
      message: "Active organization updated successfully.",
    });
  };

  updateRole = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateOrganizationMemberRequestSchema,
    );
    const result = await this.membersService.updateMemberRole({
      organizationId: requireOrganizationId(request),
      actorUserId: auth.sub,
      membershipId: requireResourceId(request, "memberId"),
      role: body.role,
    });
    ok(response, result, {
      message: "Organization member updated successfully.",
    });
  };

  remove = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.membersService.removeMember({
      organizationId: requireOrganizationId(request),
      actorUserId: auth.sub,
      membershipId: requireResourceId(request, "memberId"),
    });
    ok(response, result, {
      message: "Organization member removed successfully.",
    });
  };
}
