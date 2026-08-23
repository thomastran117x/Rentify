import { z } from "zod";

import {
  organizationResourceIdSchema,
  organizationRoleSchema,
  type OrganizationRole,
  type OrganizationSummary,
} from "@/features/organizations/organizations.model";

export const setActiveOrganizationRequestSchema = z.object({
  organizationId: organizationResourceIdSchema,
});

export const updateOrganizationMemberRequestSchema = z.object({
  role: organizationRoleSchema,
});

export type SetActiveOrganizationRequestBody = z.infer<
  typeof setActiveOrganizationRequestSchema
>;
export type UpdateOrganizationMemberRequestBody = z.infer<
  typeof updateOrganizationMemberRequestSchema
>;

export type OrganizationScopedRole = OrganizationRole;

export interface SetActiveOrganizationInput {
  userId: string;
  organizationId: string;
}

export interface SetActiveOrganizationResult {
  activeOrganization: OrganizationSummary;
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
