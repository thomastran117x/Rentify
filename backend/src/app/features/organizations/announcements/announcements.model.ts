import { z } from "zod";
import { organizationResourceIdSchema } from "@/features/organizations/organizations.model";
import type { Uuid } from "@/configuration/validation/uuid";

export const organizationAnnouncementStatusSchema = z.enum([
  "draft",
  "published",
]);
export type OrganizationAnnouncementStatus = z.infer<
  typeof organizationAnnouncementStatusSchema
>;

export const createOrganizationAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200),
    body: z.string().trim().min(1, "Body is required.").max(10000),
    status: organizationAnnouncementStatusSchema.default("draft"),
  })
  .strict();

export const updateOrganizationAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200).optional(),
    body: z.string().trim().min(1, "Body is required.").max(10000).optional(),
    status: organizationAnnouncementStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

export const listOrganizationAnnouncementsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    status: organizationAnnouncementStatusSchema.optional(),
  })
  .strict();

export const organizationAnnouncementIdSchema = organizationResourceIdSchema;

export type CreateOrganizationAnnouncementBody = z.infer<
  typeof createOrganizationAnnouncementSchema
>;
export type UpdateOrganizationAnnouncementBody = z.infer<
  typeof updateOrganizationAnnouncementSchema
>;
export type ListOrganizationAnnouncementsQuery = z.infer<
  typeof listOrganizationAnnouncementsQuerySchema
>;

export interface OrganizationAnnouncementAuthorSummary {
  id: Uuid;
  email: string;
  username: string;
  avatarUrl?: string;
}

export interface OrganizationAnnouncementRecord {
  id: Uuid;
  organizationId: Uuid;
  author?: OrganizationAnnouncementAuthorSummary;
  title: string;
  body: string;
  status: OrganizationAnnouncementStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationAnnouncementPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListOrganizationAnnouncementsResult {
  announcements: OrganizationAnnouncementRecord[];
  pagination: OrganizationAnnouncementPagination;
}

export interface ListOrganizationAnnouncementsInput
  extends ListOrganizationAnnouncementsQuery {
  organizationId: Uuid;
  actorUserId: Uuid;
}

export interface CreateOrganizationAnnouncementInput
  extends CreateOrganizationAnnouncementBody {
  organizationId: Uuid;
  actorUserId: Uuid;
}

export interface UpdateOrganizationAnnouncementInput
  extends UpdateOrganizationAnnouncementBody {
  organizationId: Uuid;
  actorUserId: Uuid;
  announcementId: Uuid;
}

export interface DeleteOrganizationAnnouncementInput {
  organizationId: Uuid;
  actorUserId: Uuid;
  announcementId: Uuid;
}

export interface DeleteOrganizationAnnouncementResult {
  deleted: true;
  announcementId: Uuid;
}

export interface CreateOrganizationAnnouncementPersistence {
  organizationId: Uuid;
  authorUserId: Uuid | null;
  title: string;
  body: string;
  status: OrganizationAnnouncementStatus;
  publishedAt: Date | null;
}

export interface UpdateOrganizationAnnouncementPersistence {
  title?: string;
  body?: string;
  status?: OrganizationAnnouncementStatus;
  publishedAt?: Date | null;
}
