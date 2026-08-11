import type { Request, Response } from "express";
import { getQuery, getRequestUrl } from "@/configuration/http/request";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import {
  getOptionalJwtAuth,
  requireJwtAuth,
} from "@/configuration/middlewares/jwt-middleware";
import {
  RequestValidationError,
  parseRequestBody,
  parseRequestBodyWithRichText,
} from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import type { AuthPrincipal } from "@/features/auth/auth.principal";
import {
  createOrganizationInviteRequestSchema,
  createOrganizationRequestSchema,
  listPublicOrganizationsQuerySchema,
  organizationInviteTokenSchema,
  organizationResourceIdSchema,
  organizationSlugPathSchema,
  setActiveOrganizationRequestSchema,
  updateOrganizationMemberRequestSchema,
  updateOrganizationRequestSchema,
  updateOrganizationSlugRequestSchema,
  type ListPublicOrganizationsInput,
} from "@/features/organizations/organizations.model";
import {
  listOrganizationAuditQuerySchema,
  organizationAuditIdSchema,
} from "@/features/organizations/organization-audit.model";
import {
  createOrganizationAnnouncementSchema,
  listOrganizationAnnouncementsQuerySchema,
  organizationAnnouncementIdSchema,
  updateOrganizationAnnouncementSchema,
} from "@/features/organizations/organization-announcement.model";
import {
  createOrganizationBlogSchema,
  listOrganizationBlogQuerySchema,
  listPublicBlogFeedQuerySchema,
  listPublicOrganizationBlogQuerySchema,
  organizationBlogIdSchema,
  organizationBlogSlugSchema,
  updateOrganizationBlogSchema,
} from "@/features/organizations/organization-blog.model";
import {
  createOrganizationReviewSchema,
  listOrganizationReviewsQuerySchema,
  organizationReviewIdSchema,
  replyOrganizationReviewSchema,
  updateOrganizationReviewSchema,
} from "@/features/organizations/organization-review.model";
import { OrganizationsService } from "@/features/organizations/organizations.service";

export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const result = await this.organizationsService.listPublic(
      this.parseListPublicOrganizationsInput(request),
    );
    ok(response, result, { meta: paginationMeta(result) });
  };

  listMine = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.listMine(auth.sub);
    ok(response, result);
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      createOrganizationRequestSchema,
    );
    const result = await this.organizationsService.createOrganization({
      actorUserId: auth.sub,
      ...body,
    });
    created(response, result, {
      message: "Organization created successfully.",
    });
  };

  setActive = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      setActiveOrganizationRequestSchema,
    );
    const result = await this.organizationsService.setActiveOrganization({
      userId: auth.sub,
      organizationId: body.organizationId,
    });
    ok(response, result, {
      message: "Active organization updated successfully.",
    });
  };

  getById = async (request: Request, response: Response): Promise<void> => {
    const result = await this.organizationsService.getById(
      this.requireOrganizationId(request),
    );
    ok(response, result);
  };

  getWorkspaceById = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.getWorkspaceById(
      this.requireOrganizationId(request),
      auth.sub,
    );
    ok(response, result);
  };

  listAudit = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const query = listOrganizationAuditQuerySchema.parse(getQuery(request));
    const result = await this.organizationsService.listAudit({
      ...query,
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
    });
    ok(response, result, { meta: paginationMeta(result) });
  };

  restoreAuditEntry = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.restoreVersion({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      auditId: this.requireRouteValue(
        request,
        "auditId",
        organizationAuditIdSchema,
        "Route parameter validation failed.",
      ),
    });
    ok(response, result, {
      message: "Organization version restored successfully.",
    });
  };

  listAnnouncements = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const query = listOrganizationAnnouncementsQuerySchema.parse(
      getQuery(request),
    );
    const result = await this.organizationsService.listAnnouncements({
      ...query,
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
    });
    ok(response, result, { meta: paginationMeta(result) });
  };

  createAnnouncement = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      createOrganizationAnnouncementSchema,
    );
    const result = await this.organizationsService.createAnnouncement({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      ...body,
    });
    created(response, result, {
      message: "Organization announcement created successfully.",
    });
  };

  updateAnnouncement = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateOrganizationAnnouncementSchema,
    );
    const result = await this.organizationsService.updateAnnouncement({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      announcementId: this.requireRouteValue(
        request,
        "announcementId",
        organizationAnnouncementIdSchema,
        "Route parameter validation failed.",
      ),
      ...body,
    });
    ok(response, result, {
      message: "Organization announcement updated successfully.",
    });
  };

  deleteAnnouncement = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.deleteAnnouncement({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      announcementId: this.requireRouteValue(
        request,
        "announcementId",
        organizationAnnouncementIdSchema,
        "Route parameter validation failed.",
      ),
    });
    ok(response, result, {
      message: "Organization announcement deleted successfully.",
    });
  };

  listBlogPosts = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const query = listOrganizationBlogQuerySchema.parse(getQuery(request));
    const result = await this.organizationsService.listBlogPosts({
      ...query,
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
    });
    ok(response, result, { meta: paginationMeta(result) });
  };

  createBlogPost = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBodyWithRichText(
      request,
      createOrganizationBlogSchema,
      ["body"],
    );
    const result = await this.organizationsService.createBlogPost({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      ...body,
    });
    created(response, result, {
      message: "Organization blog post created successfully.",
    });
  };

  updateBlogPost = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBodyWithRichText(
      request,
      updateOrganizationBlogSchema,
      ["body"],
    );
    const result = await this.organizationsService.updateBlogPost({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      blogPostId: this.requireRouteValue(
        request,
        "blogPostId",
        organizationBlogIdSchema,
        "Route parameter validation failed.",
      ),
      ...body,
    });
    ok(response, result, {
      message: "Organization blog post updated successfully.",
    });
  };

  deleteBlogPost = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.deleteBlogPost({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      blogPostId: this.requireRouteValue(
        request,
        "blogPostId",
        organizationBlogIdSchema,
        "Route parameter validation failed.",
      ),
    });
    ok(response, result, {
      message: "Organization blog post deleted successfully.",
    });
  };

  listPublicBlogPosts = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = listPublicOrganizationBlogQuerySchema.parse(
      getQuery(request),
    );
    const result = await this.organizationsService.listPublicBlogPosts({
      ...query,
      organizationId: this.requireOrganizationId(request),
    });
    ok(response, result, { meta: paginationMeta(result) });
  };

  getPublicBlogPost = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const result = await this.organizationsService.getPublicBlogPostBySlug({
      organizationId: this.requireOrganizationId(request),
      slug: this.requireRouteValue(
        request,
        "slug",
        organizationBlogSlugSchema,
        "Route parameter validation failed.",
      ),
    });
    ok(response, result);
  };

  // Public, cross-organization published blog feed/search (Elasticsearch-backed).
  searchPublicBlogFeed = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = listPublicBlogFeedQuerySchema.parse(getQuery(request));
    const result = await this.organizationsService.searchPublicBlogFeed(query);
    ok(response, result, { meta: paginationMeta(result) });
  };

  listReviews = async (request: Request, response: Response): Promise<void> => {
    const query = listOrganizationReviewsQuerySchema.parse(getQuery(request));
    const result = await this.organizationsService.listReviews({
      ...query,
      organizationId: this.requireOrganizationId(request),
    });
    ok(response, result, { meta: paginationMeta(result) });
  };

  getOwnReview = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.getOwnReview({
      organizationId: this.requireOrganizationId(request),
      reviewerId: auth.sub,
    });
    ok(response, result);
  };

  createReview = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      createOrganizationReviewSchema,
    );
    const result = await this.organizationsService.createReview({
      organizationId: this.requireOrganizationId(request),
      reviewerId: auth.sub,
      ...body,
    });
    created(response, result, {
      message: "Review submitted successfully.",
    });
  };

  updateOwnReview = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateOrganizationReviewSchema,
    );
    const result = await this.organizationsService.updateOwnReview({
      organizationId: this.requireOrganizationId(request),
      reviewerId: auth.sub,
      ...body,
    });
    ok(response, result, {
      message: "Review updated successfully.",
    });
  };

  deleteOwnReview = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.deleteOwnReview({
      organizationId: this.requireOrganizationId(request),
      reviewerId: auth.sub,
    });
    ok(response, result, {
      message: "Review deleted successfully.",
    });
  };

  replyToReview = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, replyOrganizationReviewSchema);
    const result = await this.organizationsService.replyToReview({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      reviewId: this.requireRouteValue(
        request,
        "reviewId",
        organizationReviewIdSchema,
        "Route parameter validation failed.",
      ),
      ...body,
    });
    ok(response, result, {
      message: "Reply saved successfully.",
    });
  };

  removeReviewReply = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.removeReviewReply({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      reviewId: this.requireRouteValue(
        request,
        "reviewId",
        organizationReviewIdSchema,
        "Route parameter validation failed.",
      ),
    });
    ok(response, result, {
      message: "Reply removed successfully.",
    });
  };

  deleteReview = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.deleteReview({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      reviewId: this.requireRouteValue(
        request,
        "reviewId",
        organizationReviewIdSchema,
        "Route parameter validation failed.",
      ),
    });
    ok(response, result, {
      message: "Review deleted successfully.",
    });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateOrganizationRequestSchema,
    );
    const result = await this.organizationsService.update({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
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
    const result = await this.organizationsService.resolveBySlug(
      this.requireOrganizationSlug(request),
    );
    ok(response, result);
  };

  updateSlug = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateOrganizationSlugRequestSchema,
    );
    const result = await this.organizationsService.changeSlug({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      slug: body.slug,
    });
    ok(response, result, {
      message: "Organization URL updated successfully.",
    });
  };

  createInvitation = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      createOrganizationInviteRequestSchema,
    );
    const result = await this.organizationsService.createInvitation({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      email: body.email,
      role: body.role,
    });
    created(response, result, {
      message: "Organization invitation created successfully.",
    });
  };

  revokeInvitation = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.revokeInvitation({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      invitationId: this.requireResourceId(request, "inviteId"),
    });
    ok(response, result, {
      message: "Organization invitation revoked successfully.",
    });
  };

  updateMemberRole = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateOrganizationMemberRequestSchema,
    );
    const result = await this.organizationsService.updateMemberRole({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      membershipId: this.requireResourceId(request, "memberId"),
      role: body.role,
    });
    ok(response, result, {
      message: "Organization member updated successfully.",
    });
  };

  removeMember = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.removeMember({
      organizationId: this.requireOrganizationId(request),
      actorUserId: auth.sub,
      membershipId: this.requireResourceId(request, "memberId"),
    });
    ok(response, result, {
      message: "Organization member removed successfully.",
    });
  };

  previewInvitation = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.getOptionalAuth(request);
    const result = await this.organizationsService.previewInvitation({
      token: this.requireInviteToken(request),
      userId: auth?.sub,
    });
    ok(response, result);
  };

  acceptInvitation = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.organizationsService.acceptInvitation({
      token: this.requireInviteToken(request),
      userId: auth.sub,
    });
    ok(response, result, {
      message: "Organization invitation accepted successfully.",
    });
  };

  private parseListPublicOrganizationsInput(
    request: Request,
  ): ListPublicOrganizationsInput {
    const url = getRequestUrl(request);

    try {
      const query = listPublicOrganizationsQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        sort: url.searchParams.get("sort") ?? undefined,
      });

      return {
        page: query.page,
        pageSize: query.pageSize,
        query: query.q,
        sort: query.sort,
      };
    } catch (error) {
      if ("issues" in (error as object)) {
        const issues = (
          error as { issues?: Array<{ path: PropertyKey[]; message: string }> }
        ).issues;

        throw new RequestValidationError(
          "Request query validation failed.",
          (issues ?? []).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }

      throw error;
    }
  }

  private requireOrganizationId(request: Request): string {
    return this.requireResourceId(request, "id");
  }

  /**
   * Reads the slug from /organizations/by-slug/:slug.
   *
   * Validates the canonical form without normalizing, so a non-canonical
   * reference (uppercase, trailing hyphen) is rejected here rather than served
   * at a non-canonical URL. Callers normalize before requesting.
   */
  private requireOrganizationSlug(request: Request): string {
    return this.requireRouteValue(
      request,
      "slug",
      organizationSlugPathSchema,
      "Route parameter validation failed.",
    );
  }

  private requireInviteToken(request: Request): string {
    return this.requireRouteValue(
      request,
      "token",
      organizationInviteTokenSchema,
      "Route parameter validation failed.",
    );
  }

  private requireResourceId(request: Request, name: string): string {
    return this.requireRouteValue(
      request,
      name,
      organizationResourceIdSchema,
      "Route parameter validation failed.",
    );
  }

  private requireRouteValue<TValue extends string>(
    request: Request,
    name: string,
    schema: { parse: (value: string) => TValue },
    message: string,
  ): TValue {
    const value = requireSafeRouteParam(request, name);

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

  private async requireAuth(request: Request): Promise<AuthPrincipal> {
    return requireJwtAuth(request);
  }

  private async getOptionalAuth(
    request: Request,
  ): Promise<AuthPrincipal | null> {
    return getOptionalJwtAuth(request);
  }
}
