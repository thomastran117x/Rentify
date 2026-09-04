import type { Request, Response } from "express";
import { getQuery } from "@/configuration/http/request";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  requireAuth,
  requireOrganizationId,
  requireResourceId,
} from "@/features/organizations/organizations.request-helpers";
import {
  createOrganizationAnnouncementSchema,
  listOrganizationAnnouncementsQuerySchema,
  organizationAnnouncementIdSchema,
  updateOrganizationAnnouncementSchema,
} from "@/features/organizations/announcements/announcements.model";
import { OrganizationAnnouncementService } from "@/features/organizations/announcements/announcements.service";
import { asUuid } from "@/configuration/validation/uuid";

export class OrganizationAnnouncementsController {
  constructor(
    private readonly announcementsService: OrganizationAnnouncementService,
  ) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const query = listOrganizationAnnouncementsQuerySchema.parse(
      getQuery(request),
    );
    const result = await this.announcementsService.list({
      ...query,
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
    });
    ok(response, result, { meta: paginationMeta(result) });
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(
      request,
      createOrganizationAnnouncementSchema,
    );
    const result = await this.announcementsService.create({
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
      ...body,
    });
    created(response, result, {
      message: "Organization announcement created successfully.",
    });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateOrganizationAnnouncementSchema,
    );
    const result = await this.announcementsService.update({
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
      announcementId: asUuid(requireResourceId(request, "announcementId")),
      ...body,
    });
    ok(response, result, {
      message: "Organization announcement updated successfully.",
    });
  };

  delete = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.announcementsService.delete({
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
      announcementId: asUuid(requireResourceId(request, "announcementId")),
    });
    ok(response, result, {
      message: "Organization announcement deleted successfully.",
    });
  };
}
