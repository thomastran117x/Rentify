import {
  deleteAuthenticatedJson,
  getAuthenticatedJson,
  getOptionalAuthJson,
  patchAuthenticatedJson,
  postAuthenticatedJson,
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
  | "seasonal_pricing.restored";

export type OrganizationAuditResourceType =
  | "organization"
  | "invitation"
  | "member"
  | "posting"
  | "posting_availability"
  | "seasonal_pricing";

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

function buildPublicOrganizationsPath(input?: ListPublicOrganizationsInput): string {
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

