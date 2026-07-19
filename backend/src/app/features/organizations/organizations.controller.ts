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
  setActiveOrganizationRequestSchema,
  updateOrganizationMemberRequestSchema,
  updateOrganizationRequestSchema,
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

  list = async (context: Context<AppBindings>): Promise<Response> => {
    const result = await this.organizationsService.listPublic(
      this.parseListPublicOrganizationsInput(context),
    );
    return ok(context, result, { meta: paginationMeta(result) });
  };

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
    const result = await this.organizationsService.getById(
      this.requireOrganizationId(context),
    );
    return ok(context, result);
  };

  getWorkspaceById = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.getWorkspaceById(
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

  listAnnouncements = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const query = listOrganizationAnnouncementsQuerySchema.parse(
      context.req.query(),
    );
    const result = await this.organizationsService.listAnnouncements({
      ...query,
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
    });
    return ok(context, result, { meta: paginationMeta(result) });
  };

  createAnnouncement = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      createOrganizationAnnouncementSchema,
    );
    const result = await this.organizationsService.createAnnouncement({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      ...body,
    });
    return created(context, result, {
      message: "Organization announcement created successfully.",
    });
  };

  updateAnnouncement = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      updateOrganizationAnnouncementSchema,
    );
    const result = await this.organizationsService.updateAnnouncement({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      announcementId: this.requireRouteValue(
        context,
        "announcementId",
        organizationAnnouncementIdSchema,
        "Route parameter validation failed.",
      ),
      ...body,
    });
    return ok(context, result, {
      message: "Organization announcement updated successfully.",
    });
  };

  deleteAnnouncement = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.deleteAnnouncement({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      announcementId: this.requireRouteValue(
        context,
        "announcementId",
        organizationAnnouncementIdSchema,
        "Route parameter validation failed.",
      ),
    });
    return ok(context, result, {
      message: "Organization announcement deleted successfully.",
    });
  };

  listBlogPosts = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const query = listOrganizationBlogQuerySchema.parse(context.req.query());
    const result = await this.organizationsService.listBlogPosts({
      ...query,
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
    });
    return ok(context, result, { meta: paginationMeta(result) });
  };

  createBlogPost = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBodyWithRichText(
      context,
      createOrganizationBlogSchema,
      ["body"],
    );
    const result = await this.organizationsService.createBlogPost({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      ...body,
    });
    return created(context, result, {
      message: "Organization blog post created successfully.",
    });
  };

  updateBlogPost = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBodyWithRichText(
      context,
      updateOrganizationBlogSchema,
      ["body"],
    );
    const result = await this.organizationsService.updateBlogPost({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      blogPostId: this.requireRouteValue(
        context,
        "blogPostId",
        organizationBlogIdSchema,
        "Route parameter validation failed.",
      ),
      ...body,
    });
    return ok(context, result, {
      message: "Organization blog post updated successfully.",
    });
  };

  deleteBlogPost = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.deleteBlogPost({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      blogPostId: this.requireRouteValue(
        context,
        "blogPostId",
        organizationBlogIdSchema,
        "Route parameter validation failed.",
      ),
    });
    return ok(context, result, {
      message: "Organization blog post deleted successfully.",
    });
  };

  listPublicBlogPosts = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const query = listPublicOrganizationBlogQuerySchema.parse(
      context.req.query(),
    );
    const result = await this.organizationsService.listPublicBlogPosts({
      ...query,
      organizationId: this.requireOrganizationId(context),
    });
    return ok(context, result, { meta: paginationMeta(result) });
  };

  getPublicBlogPost = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const result = await this.organizationsService.getPublicBlogPostBySlug({
      organizationId: this.requireOrganizationId(context),
      slug: this.requireRouteValue(
        context,
        "slug",
        organizationBlogSlugSchema,
        "Route parameter validation failed.",
      ),
    });
    return ok(context, result);
  };

  listReviews = async (context: Context<AppBindings>): Promise<Response> => {
    const query = listOrganizationReviewsQuerySchema.parse(context.req.query());
    const result = await this.organizationsService.listReviews({
      ...query,
      organizationId: this.requireOrganizationId(context),
    });
    return ok(context, result, { meta: paginationMeta(result) });
  };

  getOwnReview = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.getOwnReview({
      organizationId: this.requireOrganizationId(context),
      reviewerId: auth.sub,
    });
    return ok(context, result);
  };

  createReview = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      createOrganizationReviewSchema,
    );
    const result = await this.organizationsService.createReview({
      organizationId: this.requireOrganizationId(context),
      reviewerId: auth.sub,
      ...body,
    });
    return created(context, result, {
      message: "Review submitted successfully.",
    });
  };

  updateOwnReview = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      updateOrganizationReviewSchema,
    );
    const result = await this.organizationsService.updateOwnReview({
      organizationId: this.requireOrganizationId(context),
      reviewerId: auth.sub,
      ...body,
    });
    return ok(context, result, {
      message: "Review updated successfully.",
    });
  };

  deleteOwnReview = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.deleteOwnReview({
      organizationId: this.requireOrganizationId(context),
      reviewerId: auth.sub,
    });
    return ok(context, result, {
      message: "Review deleted successfully.",
    });
  };

  replyToReview = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, replyOrganizationReviewSchema);
    const result = await this.organizationsService.replyToReview({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      reviewId: this.requireRouteValue(
        context,
        "reviewId",
        organizationReviewIdSchema,
        "Route parameter validation failed.",
      ),
      ...body,
    });
    return ok(context, result, {
      message: "Reply saved successfully.",
    });
  };

  removeReviewReply = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.removeReviewReply({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      reviewId: this.requireRouteValue(
        context,
        "reviewId",
        organizationReviewIdSchema,
        "Route parameter validation failed.",
      ),
    });
    return ok(context, result, {
      message: "Reply removed successfully.",
    });
  };

  deleteReview = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.organizationsService.deleteReview({
      organizationId: this.requireOrganizationId(context),
      actorUserId: auth.sub,
      reviewId: this.requireRouteValue(
        context,
        "reviewId",
        organizationReviewIdSchema,
        "Route parameter validation failed.",
      ),
    });
    return ok(context, result, {
      message: "Review deleted successfully.",
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

  private parseListPublicOrganizationsInput(
    context: Context<AppBindings>,
  ): ListPublicOrganizationsInput {
    const url = new URL(context.req.url);

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
