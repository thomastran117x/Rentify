import { z } from "zod";

import {
  organizationResourceIdSchema,
  organizationRoleSchema,
  type OrganizationRole,
  type OrganizationSummary,
} from "@/features/organizations/organizations.model";
import type { Uuid } from "@/configuration/validation/uuid";

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
  userId: Uuid;
  organizationId: Uuid;
}

export interface SetActiveOrganizationResult {
  activeOrganization: OrganizationSummary;
}

export interface UpdateOrganizationMemberInput {
  organizationId: Uuid;
  actorUserId: Uuid;
  membershipId: Uuid;
  role: OrganizationRole;
}

export interface RemoveOrganizationMemberInput {
  organizationId: Uuid;
  actorUserId: Uuid;
  membershipId: Uuid;
}
