import { z } from "zod";

import {
  organizationSlugInputSchema,
  sharedOrganizationProfileShape,
  type OrganizationMemberRecord,
  type OrganizationInvitationRecord,
  type OrganizationMembershipSummary,
  type OrganizationProfileFields,
  type OrganizationProfileInput,
  type OrganizationRole,
  type OrganizationSearchSource,
  type OrganizationSummary,
} from "@/features/organizations/organizations.model";
import type { Uuid } from "@/configuration/validation/uuid";

export const createOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ...sharedOrganizationProfileShape,
});

// `slug` is deliberately absent: changing the public URL retires the old one
// and has consequences a routine profile save should never trigger. It has its
// own endpoint and request schema below.
export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ...sharedOrganizationProfileShape,
});

export const updateOrganizationSlugRequestSchema = z.object({
  slug: organizationSlugInputSchema,
});

export const publicOrganizationSortSchema = z.enum([
  "relevance",
  "nameAsc",
  "nameDesc",
  "newest",
  "oldest",
]);
export type PublicOrganizationSort = z.infer<
  typeof publicOrganizationSortSchema
>;

export const listPublicOrganizationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(100).optional(),
  sort: publicOrganizationSortSchema.optional(),
});

export type CreateOrganizationRequestBody = z.infer<
  typeof createOrganizationRequestSchema
>;
export type UpdateOrganizationRequestBody = z.infer<
  typeof updateOrganizationRequestSchema
>;
export type UpdateOrganizationSlugRequestBody = z.infer<
  typeof updateOrganizationSlugRequestSchema
>;
export type ListPublicOrganizationsQuery = z.infer<
  typeof listPublicOrganizationsQuerySchema
>;

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

export interface PublicOrganizationSummary extends PublicOrganizationStats {
  id: Uuid;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicOrganizationDetailResult {
  organization: PublicOrganizationSummary & PublicOrganizationProfileFields;
  stats: PublicOrganizationStats;
}

export interface PublicOrganizationListResult {
  organizations: Array<
    PublicOrganizationSummary & PublicOrganizationProfileFields
  >;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  query?: string;
  source?: OrganizationSearchSource;
}

export interface OrganizationWorkspaceResult {
  memberships: OrganizationMembershipSummary[];
  activeOrganization?: OrganizationSummary;
}

export interface OrganizationWorkspaceDetailResult {
  organization: {
    id: Uuid;
    slug: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  } & OrganizationProfileFields;
  viewerRole: OrganizationRole;
  members: OrganizationMemberRecord[];
  invitations: OrganizationInvitationRecord[];
}

export interface CreateOrganizationInput extends OrganizationProfileInput {
  actorUserId: Uuid;
  name: string;
}

export interface CreateOrganizationResult {
  organization: OrganizationSummary;
  membership: OrganizationMembershipSummary;
}

export interface UpdateOrganizationInput extends OrganizationProfileInput {
  organizationId: Uuid;
  actorUserId: Uuid;
  name: string;
}

export interface ChangeOrganizationSlugInput {
  organizationId: Uuid;
  actorUserId: Uuid;
  slug: string;
}

export interface ListPublicOrganizationsInput {
  page: number;
  pageSize: number;
  query?: string;
  sort?: PublicOrganizationSort;
}
