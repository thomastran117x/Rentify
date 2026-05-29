import {
  deleteAuthenticatedJson,
  getAuthenticatedJson,
  patchAuthenticatedJson,
  postAuthenticatedJson,
} from "@/lib/auth/api";
import { readStoredSession } from "@/lib/auth/storage";
import { getDeviceId, getDevicePlatform } from "@/lib/auth/device";
import type { ActiveOrganizationSummary } from "@/lib/auth/types";
import { readJson, toApiError, unwrapApiResponse } from "@/lib/api/response";
import { resolveApiBaseUrl } from "@/lib/env";

const apiBaseUrl = resolveApiBaseUrl();

export type OrganizationRole = "primary_manager" | "manager" | "operator";
export type OrganizationInviteStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

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

export interface OrganizationDetailResult {
  organization: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  viewerRole: OrganizationRole;
  members: OrganizationMember[];
  invitations: OrganizationInvite[];
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

async function fetchOptionalAuth<TResponse>(path: string): Promise<TResponse> {
  const session = readStoredSession();
  const deviceId = getDeviceId();
  const devicePlatform = getDevicePlatform();

  for (const includeAuth of [Boolean(session?.accessToken), false]) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(includeAuth && session?.accessToken
          ? { authorization: `Bearer ${session.accessToken}` }
          : {}),
        ...(deviceId ? { "x-device-id": deviceId } : {}),
        ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
      },
      credentials: "include",
    });
    const payload = await readJson(response);

    if (response.ok) {
      return unwrapApiResponse<TResponse>(payload);
    }

    if (includeAuth && response.status === 401) {
      continue;
    }

    throw toApiError(response, payload);
  }

  throw new Error("Organization request could not be completed.");
}

export const organizationsApi = {
  getMine(): Promise<OrganizationWorkspaceResult> {
    return getAuthenticatedJson<OrganizationWorkspaceResult>("/organizations/me");
  },
  setActive(
    input: SetActiveOrganizationInput,
  ): Promise<{ activeOrganization: ActiveOrganizationSummary }> {
    return postAuthenticatedJson<{ activeOrganization: ActiveOrganizationSummary }>(
      "/organizations/me/active",
      input,
    );
  },
  getById(id: string): Promise<OrganizationDetailResult> {
    return getAuthenticatedJson<OrganizationDetailResult>(`/organizations/${id}`);
  },
  rename(
    id: string,
    name: string,
  ): Promise<ActiveOrganizationSummary> {
    return patchAuthenticatedJson<ActiveOrganizationSummary>(
      `/organizations/${id}`,
      { name },
    );
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
    return fetchOptionalAuth<PreviewOrganizationInviteResult>(
      `/organizations/invitations/${encodeURIComponent(token)}`,
    );
  },
  acceptInvite(
    token: string,
  ): Promise<AcceptOrganizationInviteResult> {
    return postAuthenticatedJson<AcceptOrganizationInviteResult>(
      `/organizations/invitations/${encodeURIComponent(token)}/accept`,
      {},
    );
  },
};
