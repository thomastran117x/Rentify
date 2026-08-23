import { containerTokens } from "@/configuration/bootstrap/container";
import type { OrganizationProfileController } from "@/features/organizations/profile/profile.controller";
import type { OrganizationMembersController } from "@/features/organizations/members/members.controller";
import type { OrganizationInvitationsController } from "@/features/organizations/invitations/invitations.controller";
import type { OrganizationAuditController } from "@/features/organizations/audit/audit.controller";
import type { OrganizationAnnouncementsController } from "@/features/organizations/announcements/announcements.controller";
import type { OrganizationBlogController } from "@/features/organizations/blog/blog.controller";
import type { OrganizationBlogCommentsController } from "@/features/organizations/blog/comments/comments.controller";
import type { OrganizationReviewsController } from "@/features/organizations/reviews/reviews.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

// `/organizations/me` and `/organizations/me/active` are depth-2 GETs/POSTs
// under `/organizations/*`, the same depth as `GET/PATCH /organizations/:id`
// registered by organizationsProfileRouteModule below. This module must stay
// registered before that one (see registry.ts) or `:id` would shadow `me`.
export const organizationsMembersRouteModule: RouteModule = {
  id: "organizations-members",
  register(app, { resolveHandler }) {
    app.get(
      "/organizations/me",
      resolveHandler<OrganizationMembersController>(
        containerTokens.organizationMembersController,
        "listMine",
      ),
    );
    app.post(
      "/organizations/me/active",
      resolveHandler<OrganizationMembersController>(
        containerTokens.organizationMembersController,
        "setActive",
      ),
    );
    app.patch(
      "/organizations/:id/members/:memberId",
      resolveHandler<OrganizationMembersController>(
        containerTokens.organizationMembersController,
        "updateRole",
      ),
    );
    app.delete(
      "/organizations/:id/members/:memberId",
      resolveHandler<OrganizationMembersController>(
        containerTokens.organizationMembersController,
        "remove",
      ),
    );
  },
};

export const organizationsInvitationsRouteModule: RouteModule = {
  id: "organizations-invitations",
  register(app, { resolveHandler }) {
    app.get(
      "/organizations/invitations/:token",
      resolveHandler<OrganizationInvitationsController>(
        containerTokens.organizationInvitationsController,
        "preview",
      ),
    );
    app.post(
      "/organizations/invitations/:token/accept",
      resolveHandler<OrganizationInvitationsController>(
        containerTokens.organizationInvitationsController,
        "accept",
      ),
    );
    app.post(
      "/organizations/:id/invitations",
      resolveHandler<OrganizationInvitationsController>(
        containerTokens.organizationInvitationsController,
        "create",
      ),
    );
    app.delete(
      "/organizations/:id/invitations/:inviteId",
      resolveHandler<OrganizationInvitationsController>(
        containerTokens.organizationInvitationsController,
        "revoke",
      ),
    );
  },
};

export const organizationsAuditRouteModule: RouteModule = {
  id: "organizations-audit",
  register(app, { resolveHandler }) {
    app.get(
      "/organizations/:id/audit",
      resolveHandler<OrganizationAuditController>(
        containerTokens.organizationAuditController,
        "list",
      ),
    );
    app.post(
      "/organizations/:id/audit/:auditId/restore",
      resolveHandler<OrganizationAuditController>(
        containerTokens.organizationAuditController,
        "restoreVersion",
      ),
    );
  },
};

export const organizationsAnnouncementsRouteModule: RouteModule = {
  id: "organizations-announcements",
  register(app, { resolveHandler }) {
    app.get(
      "/organizations/:id/announcements",
      resolveHandler<OrganizationAnnouncementsController>(
        containerTokens.organizationAnnouncementsController,
        "list",
      ),
    );
    app.post(
      "/organizations/:id/announcements",
      resolveHandler<OrganizationAnnouncementsController>(
        containerTokens.organizationAnnouncementsController,
        "create",
      ),
    );
    app.patch(
      "/organizations/:id/announcements/:announcementId",
      resolveHandler<OrganizationAnnouncementsController>(
        containerTokens.organizationAnnouncementsController,
        "update",
      ),
    );
    app.delete(
      "/organizations/:id/announcements/:announcementId",
      resolveHandler<OrganizationAnnouncementsController>(
        containerTokens.organizationAnnouncementsController,
        "delete",
      ),
    );
  },
};

export const organizationsBlogRouteModule: RouteModule = {
  id: "organizations-blog",
  register(app, { resolveHandler }) {
    // Public, unauthenticated global blog feed/search across all organizations
    // (Elasticsearch-backed, published posts only).
    app.get(
      "/blog",
      resolveHandler<OrganizationBlogController>(
        containerTokens.organizationBlogController,
        "searchGlobal",
      ),
    );
    // Public, unauthenticated per-organization blog reads (published posts only).
    app.get(
      "/organizations/:id/blog",
      resolveHandler<OrganizationBlogController>(
        containerTokens.organizationBlogController,
        "listPublished",
      ),
    );
    app.get(
      "/organizations/:id/blog/:slug",
      resolveHandler<OrganizationBlogController>(
        containerTokens.organizationBlogController,
        "getPublished",
      ),
    );
    // Authenticated, manager-gated blog management.
    app.get(
      "/organizations/:id/blog-posts",
      resolveHandler<OrganizationBlogController>(
        containerTokens.organizationBlogController,
        "list",
      ),
    );
    app.post(
      "/organizations/:id/blog-posts",
      resolveHandler<OrganizationBlogController>(
        containerTokens.organizationBlogController,
        "create",
      ),
    );
    app.patch(
      "/organizations/:id/blog-posts/:blogPostId",
      resolveHandler<OrganizationBlogController>(
        containerTokens.organizationBlogController,
        "update",
      ),
    );
    app.delete(
      "/organizations/:id/blog-posts/:blogPostId",
      resolveHandler<OrganizationBlogController>(
        containerTokens.organizationBlogController,
        "delete",
      ),
    );
  },
};

export const organizationsBlogCommentsRouteModule: RouteModule = {
  id: "organizations-blog-comments",
  register(app, { resolveHandler }) {
    // Blog comments on a published post. Reading is public; writing needs a
    // signed-in user and an open thread.
    app.get(
      "/organizations/:id/blog/:slug/comments",
      resolveHandler<OrganizationBlogCommentsController>(
        containerTokens.organizationBlogCommentsController,
        "list",
      ),
    );
    app.post(
      "/organizations/:id/blog/:slug/comments",
      resolveHandler<OrganizationBlogCommentsController>(
        containerTokens.organizationBlogCommentsController,
        "create",
      ),
    );
    // Registered before the `:commentId` routes below: Express matches in
    // order, so `socket-ticket` would otherwise be read as a comment id.
    app.post(
      "/organizations/:id/blog/:slug/comments/socket-ticket",
      resolveHandler<OrganizationBlogCommentsController>(
        containerTokens.organizationBlogCommentsController,
        "socketTicket",
      ),
    );
    app.patch(
      "/organizations/:id/blog/:slug/comments/:commentId",
      resolveHandler<OrganizationBlogCommentsController>(
        containerTokens.organizationBlogCommentsController,
        "update",
      ),
    );
    app.delete(
      "/organizations/:id/blog/:slug/comments/:commentId",
      resolveHandler<OrganizationBlogCommentsController>(
        containerTokens.organizationBlogCommentsController,
        "remove",
      ),
    );
  },
};

export const organizationsReviewsRouteModule: RouteModule = {
  id: "organizations-reviews",
  register(app, { resolveHandler }) {
    // Public, unauthenticated review reads.
    app.get(
      "/organizations/:id/reviews",
      resolveHandler<OrganizationReviewsController>(
        containerTokens.organizationReviewsController,
        "list",
      ),
    );
    // Authenticated reviewer submission (renters with a completed rental).
    app.get(
      "/organizations/:id/reviews/me",
      resolveHandler<OrganizationReviewsController>(
        containerTokens.organizationReviewsController,
        "getOwn",
      ),
    );
    app.post(
      "/organizations/:id/reviews",
      resolveHandler<OrganizationReviewsController>(
        containerTokens.organizationReviewsController,
        "create",
      ),
    );
    app.put(
      "/organizations/:id/reviews/me",
      resolveHandler<OrganizationReviewsController>(
        containerTokens.organizationReviewsController,
        "updateOwn",
      ),
    );
    app.delete(
      "/organizations/:id/reviews/me",
      resolveHandler<OrganizationReviewsController>(
        containerTokens.organizationReviewsController,
        "deleteOwn",
      ),
    );
    // Manager-gated review moderation.
    app.put(
      "/organizations/:id/reviews/:reviewId/reply",
      resolveHandler<OrganizationReviewsController>(
        containerTokens.organizationReviewsController,
        "reply",
      ),
    );
    app.delete(
      "/organizations/:id/reviews/:reviewId/reply",
      resolveHandler<OrganizationReviewsController>(
        containerTokens.organizationReviewsController,
        "removeReply",
      ),
    );
    app.delete(
      "/organizations/:id/reviews/:reviewId",
      resolveHandler<OrganizationReviewsController>(
        containerTokens.organizationReviewsController,
        "delete",
      ),
    );
  },
};

// Owns `GET /organizations`, `POST /organizations`, `GET/PATCH
// /organizations/:id`, and `/organizations/:id/slug` and `/workspace`. Must
// stay registered after organizationsMembersRouteModule (see that module's
// comment) since `GET /organizations/:id` would otherwise shadow `GET
// /organizations/me`.
export const organizationsProfileRouteModule: RouteModule = {
  id: "organizations-profile",
  register(app, { resolveHandler }) {
    app.get(
      "/organizations",
      resolveHandler<OrganizationProfileController>(
        containerTokens.organizationProfileController,
        "list",
      ),
    );
    app.post(
      "/organizations",
      resolveHandler<OrganizationProfileController>(
        containerTokens.organizationProfileController,
        "create",
      ),
    );
    // Two literal segments, so this cannot be shadowed by the single-segment
    // "/organizations/:id" route below.
    app.get(
      "/organizations/by-slug/:slug",
      resolveHandler<OrganizationProfileController>(
        containerTokens.organizationProfileController,
        "resolveBySlug",
      ),
    );
    app.get(
      "/organizations/:id/workspace",
      resolveHandler<OrganizationProfileController>(
        containerTokens.organizationProfileController,
        "getWorkspaceById",
      ),
    );
    app.get(
      "/organizations/:id",
      resolveHandler<OrganizationProfileController>(
        containerTokens.organizationProfileController,
        "getById",
      ),
    );
    app.patch(
      "/organizations/:id",
      resolveHandler<OrganizationProfileController>(
        containerTokens.organizationProfileController,
        "update",
      ),
    );
    // Separate from the profile update: retiring the public URL has
    // consequences a routine profile save should never trigger.
    app.patch(
      "/organizations/:id/slug",
      resolveHandler<OrganizationProfileController>(
        containerTokens.organizationProfileController,
        "updateSlug",
      ),
    );
  },
};
