import { z } from "zod";

export const organizationRoleSchema = z.enum([
  "primary_manager",
  "manager",
  "operator",
]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const organizationInviteStatusSchema = z.enum([
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export type OrganizationInviteStatus = z.infer<
  typeof organizationInviteStatusSchema
>;

export const organizationResourceIdSchema = z.uuid();
export const organizationInviteTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(200);

export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
});

export const createOrganizationInviteRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  role: organizationRoleSchema,
});

export const setActiveOrganizationRequestSchema = z.object({
  organizationId: organizationResourceIdSchema,
});

export const updateOrganizationMemberRequestSchema = z.object({
  role: organizationRoleSchema,
});

export type UpdateOrganizationRequestBody = z.infer<
  typeof updateOrganizationRequestSchema
>;
export type CreateOrganizationInviteRequestBody = z.infer<
  typeof createOrganizationInviteRequestSchema
>;
export type SetActiveOrganizationRequestBody = z.infer<
  typeof setActiveOrganizationRequestSchema
>;
export type UpdateOrganizationMemberRequestBody = z.infer<
  typeof updateOrganizationMemberRequestSchema
>;

export interface OrganizationSummary {
  id: string;
  name: string;
  role: OrganizationRole;
}

export interface OrganizationMembershipSummary extends OrganizationSummary {
  membershipId: string;
  joinedAt: string;
  isActive: boolean;
}

export interface OrganizationMemberRecord {
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

export interface OrganizationInvitationActorSummary {
  id: string;
  email: string;
  username: string;
}

export interface OrganizationInvitationRecord {
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
  invitedBy: OrganizationInvitationActorSummary;
  acceptedBy?: OrganizationInvitationActorSummary;
}

export interface OrganizationWorkspaceResult {
  memberships: OrganizationMembershipSummary[];
  activeOrganization?: OrganizationSummary;
}

export interface OrganizationDetailResult {
  organization: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  viewerRole: OrganizationRole;
  members: OrganizationMemberRecord[];
  invitations: OrganizationInvitationRecord[];
}

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

export interface SetActiveOrganizationResult {
  activeOrganization: OrganizationSummary;
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

export interface UpdateOrganizationInput {
  organizationId: string;
  actorUserId: string;
  name: string;
}

export interface SetActiveOrganizationInput {
  userId: string;
  organizationId: string;
}

export interface UpdateOrganizationMemberInput {
  organizationId: string;
  actorUserId: string;
  membershipId: string;
  role: OrganizationRole;
}

export interface RemoveOrganizationMemberInput {
  organizationId: string;
  actorUserId: string;
  membershipId: string;
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

export function normalizeOrganizationInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function maskEmailAddress(email: string): string {
  const [localPart, domain] = email.split("@");

  if (!localPart || !domain) {
    return "hidden";
  }

  const normalizedLocalPart = localPart.trim();
  const visiblePrefix = normalizedLocalPart.slice(0, 1) || "*";
  return `${visiblePrefix}***@${domain}`;
}
