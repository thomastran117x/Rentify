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
  createOrganizationReviewSchema,
  listOrganizationReviewsQuerySchema,
  replyOrganizationReviewSchema,
  updateOrganizationReviewSchema,
} from "@/features/organizations/reviews/reviews.model";
import { OrganizationReviewService } from "@/features/organizations/reviews/reviews.service";

export class OrganizationReviewsController {
  constructor(private readonly reviewsService: OrganizationReviewService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const query = listOrganizationReviewsQuerySchema.parse(getQuery(request));
    const result = await this.reviewsService.list({
      ...query,
      organizationId: requireOrganizationId(request),
    });
    ok(response, result, { meta: paginationMeta(result) });
  };

  getOwn = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.reviewsService.getOwn({
      organizationId: requireOrganizationId(request),
      reviewerId: auth.sub,
    });
    ok(response, result);
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(
      request,
      createOrganizationReviewSchema,
    );
    const result = await this.reviewsService.create({
      organizationId: requireOrganizationId(request),
      reviewerId: auth.sub,
      ...body,
    });
    created(response, result, {
      message: "Review submitted successfully.",
    });
  };

  updateOwn = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateOrganizationReviewSchema,
    );
    const result = await this.reviewsService.updateOwn({
      organizationId: requireOrganizationId(request),
      reviewerId: auth.sub,
      ...body,
    });
    ok(response, result, {
      message: "Review updated successfully.",
    });
  };

  deleteOwn = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.reviewsService.deleteOwn({
      organizationId: requireOrganizationId(request),
      reviewerId: auth.sub,
    });
    ok(response, result, {
      message: "Review deleted successfully.",
    });
  };

  reply = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBody(request, replyOrganizationReviewSchema);
    const result = await this.reviewsService.reply({
      organizationId: requireOrganizationId(request),
      actorUserId: auth.sub,
      reviewId: requireResourceId(request, "reviewId"),
      ...body,
    });
    ok(response, result, {
      message: "Reply saved successfully.",
    });
  };

  removeReply = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.reviewsService.removeReply({
      organizationId: requireOrganizationId(request),
      actorUserId: auth.sub,
      reviewId: requireResourceId(request, "reviewId"),
    });
    ok(response, result, {
      message: "Reply removed successfully.",
    });
  };

  delete = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.reviewsService.delete({
      organizationId: requireOrganizationId(request),
      actorUserId: auth.sub,
      reviewId: requireResourceId(request, "reviewId"),
    });
    ok(response, result, {
      message: "Review deleted successfully.",
    });
  };
}
