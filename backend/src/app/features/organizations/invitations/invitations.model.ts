import { z } from "zod";

import {
  organizationRoleSchema,
  type OrganizationInvitationRecord,
  type OrganizationInviteStatus,
  type OrganizationMembershipSummary,
  type OrganizationRole,
  type OrganizationSummary,
} from "@/features/organizations/organizations.model";

export const createOrganizationInviteRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  role: organizationRoleSchema,
});

export type CreateOrganizationInviteRequestBody = z.infer<
  typeof createOrganizationInviteRequestSchema
>;

export interface OrganizationInvitePreviewResult {
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

export interface CreateOrganizationInviteResult {
  invitation: OrganizationInvitationRecord;
}

export interface AcceptOrganizationInviteResult {
  accepted: true;
  organization: OrganizationSummary;
  membership: OrganizationMembershipSummary;
}

export interface CreateOrganizationInviteInput {
  organizationId: string;
  actorUserId: string;
  email: string;
  role: OrganizationRole;
}

export interface RevokeOrganizationInviteInput {
  organizationId: string;
  actorUserId: string;
  invitationId: string;
}

export interface AcceptOrganizationInviteInput {
  token: string;
  userId: string;
}

export interface PreviewOrganizationInviteInput {
  token: string;
  userId?: string;
}
