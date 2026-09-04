import { z } from "zod";

import {
  organizationRoleSchema,
  type OrganizationInvitationRecord,
  type OrganizationInviteStatus,
  type OrganizationMembershipSummary,
  type OrganizationRole,
  type OrganizationSummary,
} from "@/features/organizations/organizations.model";
import type { Uuid } from "@/configuration/validation/uuid";

export const createOrganizationInviteRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  role: organizationRoleSchema,
});

export type CreateOrganizationInviteRequestBody = z.infer<
  typeof createOrganizationInviteRequestSchema
>;

export interface OrganizationInvitePreviewResult {
  invitation: {
    organizationId: Uuid;
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
  organizationId: Uuid;
  actorUserId: Uuid;
  email: string;
  role: OrganizationRole;
}

export interface RevokeOrganizationInviteInput {
  organizationId: Uuid;
  actorUserId: Uuid;
  invitationId: Uuid;
}

export interface AcceptOrganizationInviteInput {
  token: string;
  userId: Uuid;
}

export interface PreviewOrganizationInviteInput {
  token: string;
  userId?: Uuid;
}
