import {
  deleteAuthenticatedJson,
  getAuthenticatedJson,
  getOptionalAuthJson,
  patchAuthenticatedJson,
  postAuthenticatedJson,
  putAuthenticatedJson,
} from "@/lib/auth/api";
import { publicJson } from "@/lib/api/client";
import type { ActiveOrganizationSummary } from "@/lib/auth/types";

export type OrganizationRole = "primary_manager" | "manager" | "operator";
export type OrganizationInviteStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export type OrganizationAuditAction =
  | "organization.created"
  | "organization.renamed"
  | "organization.restored"
  | "invitation.created"
  | "invitation.reissued"
  | "invitation.revoked"
  | "invitation.accepted"
  | "invitation.expired"
  | "invitation.restored"
  | "member.role_updated"
  | "member.removed"
  | "member.restored"
  | "posting.created"
  | "posting.updated"
  | "posting.duplicated"
  | "posting.published"
  | "posting.paused"
  | "posting.unpaused"
  | "posting.archived"
  | "posting.restored"
  | "posting_availability.created"
  | "posting_availability.updated"
  | "posting_availability.deleted"
  | "posting_availability.restored"
  | "seasonal_pricing.created"
  | "seasonal_pricing.updated"
  | "seasonal_pricing.deleted"
  | "seasonal_pricing.restored"
  | "announcement.created"
  | "announcement.updated"
  | "announcement.published"
  | "announcement.unpublished"
  | "announcement.deleted"
  | "review.replied"
  | "review.reply_removed"
  | "review.deleted";

export type OrganizationAuditResourceType =
  | "organization"
  | "invitation"
  | "member"
  | "posting"
  | "posting_availability"
  | "seasonal_pricing"
  | "announcement"
  | "review";

export interface OrganizationMembershipSummary
  extends ActiveOrganizationSummary {
  membershipId: string;
  joinedAt: string;
  isActive: boolean;
}

export interface OrganizationMember {
  membershipId: string;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  username: string;
  avatarUrl?: string;
  role: OrganizationRole;
  joinedAt: string;
}

export interface OrganizationInvite {
  id: string;
  email: string;
  emailHint: string;
  role: OrganizationRole;
  status: OrganizationInviteStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  invitedBy: {
    id: string;
    email: string;
    username: string;
  };
  acceptedBy?: {
    id: string;
    email: string;
    username: string;
  };
}

export interface OrganizationWorkspaceResult {
  memberships: OrganizationMembershipSummary[];
  activeOrganization?: ActiveOrganizationSummary;
}

export interface OrganizationAuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface OrganizationAuditRecord {
  id: string;
  organizationId: string;
  actor?: {
    id: string;
    email: string;
    username: string;
    avatarUrl?: string;
  };
  action: OrganizationAuditAction;
  resourceType: OrganizationAuditResourceType;
  resourceId?: string;
  organizationVersion: number;
  resourceVersion?: number;
  summary: string;
  changes: OrganizationAuditChange[];
  restorable: boolean;
  restoredFromAuditId?: string;
  createdAt: string;
}

export interface OrganizationAuditResult {
  auditLogs: OrganizationAuditRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export type OrganizationAnnouncementStatus = "draft" | "published";

export interface OrganizationAnnouncementRecord {
  id: string;
  organizationId: string;
  author?: {
    id: string;
    email: string;
    username: string;
    avatarUrl?: string;
  };
  title: string;
  body: string;
  status: OrganizationAnnouncementStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationAnnouncementResult {
  announcements: OrganizationAnnouncementRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface CreateOrganizationAnnouncementInput {
  title: string;
  body: string;
  status?: OrganizationAnnouncementStatus;
}

export interface UpdateOrganizationAnnouncementInput {
  title?: string;
  body?: string;
  status?: OrganizationAnnouncementStatus;
}

export type OrganizationBlogStatus = "draft" | "published";

export type OrganizationBlogSort = "relevance" | "newest" | "oldest";

export type OrganizationBlogSearchSource = "elasticsearch" | "database";

export interface OrganizationBlogPostRecord {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name: string;
    logoUrl?: string;
  };
  author?: {
    id: string;
    email: string;
    username: string;
    avatarUrl?: string;
  };
  title: string;
  slug: string;
  excerpt?: string;
  body: string;
  coverImageUrl?: string;
  coverImageBlobName?: string;
  tags: string[];
  status: OrganizationBlogStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  // Precomputed by the API on list responses (where `body` is omitted); absent
  // on single-post reads, where `body` is present and reading time is derived.
  readingMinutes?: number;
}

export interface OrganizationBlogResult {
  posts: OrganizationBlogPostRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  source?: OrganizationBlogSearchSource;
  query?: string;
}

export interface CreateOrganizationBlogInput {
  title: string;
  body: string;
  excerpt?: string | null;
  slug?: string;
  coverImageUrl?: string | null;
  coverImageBlobName?: string | null;
  tags?: string[];
  status?: OrganizationBlogStatus;
}

export interface UpdateOrganizationBlogInput {
  title?: string;
  body?: string;
  excerpt?: string | null;
  slug?: string;
  coverImageUrl?: string | null;
  coverImageBlobName?: string | null;
  tags?: string[];
  status?: OrganizationBlogStatus;
}

export interface ListPublicBlogInput {
  page?: number;
  pageSize?: number;
  tag?: string;
  q?: string;
  sort?: OrganizationBlogSort;
}

export interface ListBlogFeedInput {
  page?: number;
  pageSize?: number;
  tag?: string;
  q?: string;
  sort?: OrganizationBlogSort;
}

export interface OrganizationReviewResponse {
  body: string;
  respondedAt: string;
  author?: {
    id: string;
    username?: string;
    avatarUrl?: string;
  };
}

export interface OrganizationReviewRecord {
  id: string;
  organizationId: string;
  reviewerId: string;
  rating: number;
  title?: string;
  comment?: string;
  reviewer: {
    username?: string;
    avatarUrl?: string;
  };
  response?: OrganizationReviewResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationReviewSummary {
  averageRating: number;
  reviewCount: number;
}

export interface OrganizationReviewsResult {
  reviews: OrganizationReviewRecord[];
  summary: OrganizationReviewSummary;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface UpsertOrganizationReviewInput {
  rating: number;
  title?: string | null;
  comment?: string | null;
}

export interface ListPublicReviewsInput {
  page?: number;
  pageSize?: number;
}

export interface OrganizationProfileFields {
  description: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  logoUrl: string | null;
  logoBlobName: string | null;
  customFields: Record<string, string> | null;
}

export type OrganizationProfileInput = Partial<OrganizationProfileFields>;

export interface PublicOrganizationProfileFields {
  description: string | null;
  websiteUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  logoUrl: string | null;
  customFields: Record<string, string> | null;
}

export interface PublicOrganizationStats {
  publishedPostingCount: number;
}

export interface PublicOrganizationSummary
  extends PublicOrganizationProfileFields,
    PublicOrganizationStats {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicOrganizationListResult {
  organizations: PublicOrganizationSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  query?: string;
}

export interface PublicOrganizationDetailResult {
  organization: PublicOrganizationSummary;
  stats: PublicOrganizationStats;
}

export interface OrganizationWorkspaceDetailResult {
  organization: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  } & OrganizationProfileFields;
  viewerRole: OrganizationRole;
  members: OrganizationMember[];
  invitations: OrganizationInvite[];
}

export type OrganizationDetailResult = OrganizationWorkspaceDetailResult;

export interface CreateOrganizationInput extends OrganizationProfileInput {
  name: string;
}

export interface UpdateOrganizationInput extends OrganizationProfileInput {
  name: string;
}

export interface CreateOrganizationResult {
  organization: ActiveOrganizationSummary;
  membership: OrganizationMembershipSummary;
}

export interface SetActiveOrganizationInput {
  organizationId: string;
}

export interface CreateOrganizationInviteInput {
  email: string;
  role: Exclude<OrganizationRole, "primary_manager">;
}

export interface PreviewOrganizationInviteResult {
  invitation: {
    organizationId: string;
    organizationName: string;
    emailHint: string;
    role: OrganizationRole;
    status: OrganizationInviteStatus;
    expiresAt: string;
  };
  viewer: {
    authenticated: boolean;
    email?: string;
    emailVerified?: boolean;
    matchesEmail: boolean;
    canAccept: boolean;
  };
}

export interface AcceptOrganizationInviteResult {
  accepted: true;
  organization: ActiveOrganizationSummary;
  membership: OrganizationMembershipSummary;
}

export interface ListPublicOrganizationsInput {
  page?: number;
  pageSize?: number;
  query?: string;
}

function buildPublicOrganizationsPath(
  input?: ListPublicOrganizationsInput,
): string {
  const searchParams = new URLSearchParams();

  if (input?.page) {
    searchParams.set("page", String(input.page));
  }
  if (input?.pageSize) {
    searchParams.set("pageSize", String(input.pageSize));
  }
  if (input?.query?.trim()) {
    searchParams.set("q", input.query.trim());
  }

  const query = searchParams.toString();
  return query ? `/organizations?${query}` : "/organizations";
}

function buildPublicBlogPath(id: string, input?: ListPublicBlogInput): string {
  const searchParams = new URLSearchParams();

  if (input?.page && input.page > 1) {
    searchParams.set("page", String(input.page));
  }

  if (input?.pageSize) {
    searchParams.set("pageSize", String(input.pageSize));
  }

  if (input?.tag?.trim()) {
    searchParams.set("tag", input.tag.trim());
  }

  if (input?.q?.trim()) {
    searchParams.set("q", input.q.trim());
  }

  if (input?.sort) {
    searchParams.set("sort", input.sort);
  }

  const query = searchParams.toString();
  return query
    ? `/organizations/${id}/blog?${query}`
    : `/organizations/${id}/blog`;
}

function buildBlogFeedPath(input?: ListBlogFeedInput): string {
  const searchParams = new URLSearchParams();

  if (input?.page && input.page > 1) {
    searchParams.set("page", String(input.page));
  }

  if (input?.pageSize) {
    searchParams.set("pageSize", String(input.pageSize));
  }

  if (input?.tag?.trim()) {
    searchParams.set("tag", input.tag.trim());
  }

  if (input?.q?.trim()) {
    searchParams.set("q", input.q.trim());
  }

  if (input?.sort) {
    searchParams.set("sort", input.sort);
  }

  const query = searchParams.toString();
  return query ? `/blog?${query}` : "/blog";
}

function buildPublicReviewsPath(
  id: string,
  input?: ListPublicReviewsInput,
): string {
  const searchParams = new URLSearchParams();

  if (input?.page && input.page > 1) {
    searchParams.set("page", String(input.page));
  }

  if (input?.pageSize) {
    searchParams.set("pageSize", String(input.pageSize));
  }

  const query = searchParams.toString();
  return query
    ? `/organizations/${id}/reviews?${query}`
    : `/organizations/${id}/reviews`;
}

export const organizationsApi = {
  listPublic(
    input?: ListPublicOrganizationsInput,
  ): Promise<PublicOrganizationListResult> {
    return publicJson<PublicOrganizationListResult>(
      "GET",
      buildPublicOrganizationsPath(input),
    );
  },
  getPublicById(id: string): Promise<PublicOrganizationDetailResult> {
    return publicJson<PublicOrganizationDetailResult>(
      "GET",
      `/organizations/${id}`,
    );
  },
  getMine(): Promise<OrganizationWorkspaceResult> {
    return getAuthenticatedJson<OrganizationWorkspaceResult>(
      "/organizations/me",
    );
  },
  create(input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
    return postAuthenticatedJson<CreateOrganizationResult>(
      "/organizations",
      input,
    );
  },
  setActive(
    input: SetActiveOrganizationInput,
  ): Promise<{ activeOrganization: ActiveOrganizationSummary }> {
    return postAuthenticatedJson<{
      activeOrganization: ActiveOrganizationSummary;
    }>("/organizations/me/active", input);
  },
  listAudit(id: string): Promise<OrganizationAuditResult> {
    return getAuthenticatedJson<OrganizationAuditResult>(
      `/organizations/${id}/audit?pageSize=10`,
    );
  },
  restoreAuditEntry(
    id: string,
    auditId: string,
  ): Promise<{ restored: true; auditLog: OrganizationAuditRecord }> {
    return postAuthenticatedJson<{
      restored: true;
      auditLog: OrganizationAuditRecord;
    }>(`/organizations/${id}/audit/${auditId}/restore`, {});
  },
  listAnnouncements(id: string): Promise<OrganizationAnnouncementResult> {
    return getAuthenticatedJson<OrganizationAnnouncementResult>(
      `/organizations/${id}/announcements?pageSize=50`,
    );
  },
  createAnnouncement(
    id: string,
    input: CreateOrganizationAnnouncementInput,
  ): Promise<OrganizationAnnouncementRecord> {
    return postAuthenticatedJson<OrganizationAnnouncementRecord>(
      `/organizations/${id}/announcements`,
      input,
    );
  },
  updateAnnouncement(
    id: string,
    announcementId: string,
    input: UpdateOrganizationAnnouncementInput,
  ): Promise<OrganizationAnnouncementRecord> {
    return patchAuthenticatedJson<OrganizationAnnouncementRecord>(
      `/organizations/${id}/announcements/${announcementId}`,
      input,
    );
  },
  deleteAnnouncement(
    id: string,
    announcementId: string,
  ): Promise<{ deleted: true; announcementId: string }> {
    return deleteAuthenticatedJson<{ deleted: true; announcementId: string }>(
      `/organizations/${id}/announcements/${announcementId}`,
    );
  },
  listBlogPosts(id: string): Promise<OrganizationBlogResult> {
    return getAuthenticatedJson<OrganizationBlogResult>(
      `/organizations/${id}/blog-posts?pageSize=50`,
    );
  },
  createBlogPost(
    id: string,
    input: CreateOrganizationBlogInput,
  ): Promise<OrganizationBlogPostRecord> {
    return postAuthenticatedJson<OrganizationBlogPostRecord>(
      `/organizations/${id}/blog-posts`,
      input,
    );
  },
  updateBlogPost(
    id: string,
    blogPostId: string,
    input: UpdateOrganizationBlogInput,
  ): Promise<OrganizationBlogPostRecord> {
    return patchAuthenticatedJson<OrganizationBlogPostRecord>(
      `/organizations/${id}/blog-posts/${blogPostId}`,
      input,
    );
  },
  deleteBlogPost(
    id: string,
    blogPostId: string,
  ): Promise<{ deleted: true; blogPostId: string }> {
    return deleteAuthenticatedJson<{ deleted: true; blogPostId: string }>(
      `/organizations/${id}/blog-posts/${blogPostId}`,
    );
  },
  listPublicBlog(
    id: string,
    input?: ListPublicBlogInput,
  ): Promise<OrganizationBlogResult> {
    return publicJson<OrganizationBlogResult>(
      "GET",
      buildPublicBlogPath(id, input),
    );
  },
  getPublicBlogPost(
    id: string,
    slug: string,
  ): Promise<OrganizationBlogPostRecord> {
    return publicJson<OrganizationBlogPostRecord>(
      "GET",
      `/organizations/${id}/blog/${encodeURIComponent(slug)}`,
    );
  },
  searchBlogFeed(input?: ListBlogFeedInput): Promise<OrganizationBlogResult> {
    return publicJson<OrganizationBlogResult>("GET", buildBlogFeedPath(input));
  },
  listPublicReviews(
    id: string,
    input?: ListPublicReviewsInput,
  ): Promise<OrganizationReviewsResult> {
    return publicJson<OrganizationReviewsResult>(
      "GET",
      buildPublicReviewsPath(id, input),
    );
  },
  getOwnReview(id: string): Promise<OrganizationReviewRecord | null> {
    return getAuthenticatedJson<OrganizationReviewRecord | null>(
      `/organizations/${id}/reviews/me`,
    );
  },
  createReview(
    id: string,
    input: UpsertOrganizationReviewInput,
  ): Promise<OrganizationReviewRecord> {
    return postAuthenticatedJson<OrganizationReviewRecord>(
      `/organizations/${id}/reviews`,
      input,
    );
  },
  updateOwnReview(
    id: string,
    input: UpsertOrganizationReviewInput,
  ): Promise<OrganizationReviewRecord> {
    return putAuthenticatedJson<OrganizationReviewRecord>(
      `/organizations/${id}/reviews/me`,
      input,
    );
  },
  deleteOwnReview(id: string): Promise<{ deleted: true; reviewId: string }> {
    return deleteAuthenticatedJson<{ deleted: true; reviewId: string }>(
      `/organizations/${id}/reviews/me`,
    );
  },
  replyToReview(
    id: string,
    reviewId: string,
    body: string,
  ): Promise<OrganizationReviewRecord> {
    return putAuthenticatedJson<OrganizationReviewRecord>(
      `/organizations/${id}/reviews/${reviewId}/reply`,
      { body },
    );
  },
  removeReviewReply(
    id: string,
    reviewId: string,
  ): Promise<OrganizationReviewRecord> {
    return deleteAuthenticatedJson<OrganizationReviewRecord>(
      `/organizations/${id}/reviews/${reviewId}/reply`,
    );
  },
  deleteReview(
    id: string,
    reviewId: string,
  ): Promise<{ deleted: true; reviewId: string }> {
    return deleteAuthenticatedJson<{ deleted: true; reviewId: string }>(
      `/organizations/${id}/reviews/${reviewId}`,
    );
  },
  getWorkspaceById(id: string): Promise<OrganizationWorkspaceDetailResult> {
    return getAuthenticatedJson<OrganizationWorkspaceDetailResult>(
      `/organizations/${id}/workspace`,
    );
  },
  update(
    id: string,
    input: UpdateOrganizationInput,
  ): Promise<ActiveOrganizationSummary> {
    return patchAuthenticatedJson<ActiveOrganizationSummary>(
      `/organizations/${id}`,
      input,
    );
  },
  rename(id: string, name: string): Promise<ActiveOrganizationSummary> {
    return this.update(id, { name });
  },
  createInvite(
    id: string,
    input: CreateOrganizationInviteInput,
  ): Promise<{ invitation: OrganizationInvite }> {
    return postAuthenticatedJson<{ invitation: OrganizationInvite }>(
      `/organizations/${id}/invitations`,
      input,
    );
  },
  revokeInvite(
    id: string,
    inviteId: string,
  ): Promise<{ invitation: OrganizationInvite }> {
    return deleteAuthenticatedJson<{ invitation: OrganizationInvite }>(
      `/organizations/${id}/invitations/${inviteId}`,
    );
  },
  updateMemberRole(
    id: string,
    memberId: string,
    role: Exclude<OrganizationRole, "primary_manager">,
  ): Promise<{ member: OrganizationMember }> {
    return patchAuthenticatedJson<{ member: OrganizationMember }>(
      `/organizations/${id}/members/${memberId}`,
      { role },
    );
  },
  removeMember(
    id: string,
    memberId: string,
  ): Promise<{ removed: true; membershipId: string }> {
    return deleteAuthenticatedJson<{ removed: true; membershipId: string }>(
      `/organizations/${id}/members/${memberId}`,
    );
  },
  previewInvite(token: string): Promise<PreviewOrganizationInviteResult> {
    return getOptionalAuthJson<PreviewOrganizationInviteResult>(
      `/organizations/invitations/${encodeURIComponent(token)}`,
    );
  },
  acceptInvite(token: string): Promise<AcceptOrganizationInviteResult> {
    return postAuthenticatedJson<AcceptOrganizationInviteResult>(
      `/organizations/invitations/${encodeURIComponent(token)}/accept`,
      {},
    );
  },
};
