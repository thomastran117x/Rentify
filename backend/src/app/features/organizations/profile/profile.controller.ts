import type { Request, Response } from "express";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  parseListPublicOrganizationsInput,
  requireAuth,
  requireOrganizationId,
  requireOrganizationSlug,
} from "@/features/organizations/organizations.request-helpers";
import {
  createOrganizationRequestSchema,
  updateOrganizationRequestSchema,
  updateOrganizationSlugRequestSchema,
} from "@/features/organizations/profile/profile.model";
import { OrganizationProfileService } from "@/features/organizations/profile/profile.service";
import { asUuid } from "@/configuration/validation/uuid";

export class OrganizationProfileController {
  constructor(private readonly profileService: OrganizationProfileService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const result = await this.profileService.listPublic(
      parseListPublicOrganizationsInput(request),
    );
    ok(response, result, { meta: paginationMeta(result) });
  };

  getById = async (request: Request, response: Response): Promise<void> => {
    const result = await this.profileService.getById(
      requireOrganizationId(request),
    );
    ok(response, result);
  };

  getWorkspaceById = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.profileService.getWorkspaceById(
      requireOrganizationId(request),
      auth.sub,
    );
    ok(response, result);
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(
      request,
      createOrganizationRequestSchema,
    );
    const result = await this.profileService.createOrganization({
      actorUserId: asUuid(auth.sub),
      ...body,
    });
    created(response, result, {
      message: "Organization created successfully.",
    });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateOrganizationRequestSchema,
    );
    const result = await this.profileService.update({
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
      ...body,
    });
    ok(response, result, {
      message: "Organization updated successfully.",
    });
  };

  resolveBySlug = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const result = await this.profileService.resolveBySlug(
      requireOrganizationSlug(request),
    );
    ok(response, result);
  };

  updateSlug = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateOrganizationSlugRequestSchema,
    );
    const result = await this.profileService.changeSlug({
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
      slug: body.slug,
    });
    ok(response, result, {
      message: "Organization URL updated successfully.",
    });
  };
}
