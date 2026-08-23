import { z } from "zod";
import { organizationResourceIdSchema } from "@/features/organizations/organizations.model";

const optionalReviewTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .nullable()
  .optional();

const optionalReviewCommentSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .nullable()
  .optional();

export const createOrganizationReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    title: optionalReviewTitleSchema,
    comment: optionalReviewCommentSchema,
  })
  .strict();

export const updateOrganizationReviewSchema = createOrganizationReviewSchema;

export const replyOrganizationReviewSchema = z
  .object({
    body: z.string().trim().min(1, "Reply is required.").max(2000),
  })
  .strict();

export const listOrganizationReviewsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const organizationReviewIdSchema = organizationResourceIdSchema;

export type CreateOrganizationReviewBody = z.infer<
  typeof createOrganizationReviewSchema
>;
export type UpdateOrganizationReviewBody = z.infer<
  typeof updateOrganizationReviewSchema
>;
export type ReplyOrganizationReviewBody = z.infer<
  typeof replyOrganizationReviewSchema
>;
export type ListOrganizationReviewsQuery = z.infer<
  typeof listOrganizationReviewsQuerySchema
>;

export interface OrganizationReviewerSummary {
  username?: string;
  avatarUrl?: string;
}

export interface OrganizationReviewResponderSummary {
  id: string;
  username?: string;
  avatarUrl?: string;
}

export interface OrganizationReviewResponse {
  body: string;
  respondedAt: string;
  author?: OrganizationReviewResponderSummary;
}

export interface OrganizationReviewRecord {
  id: string;
  organizationId: string;
  reviewerId: string;
  rating: number;
  title?: string;
  comment?: string;
  reviewer: OrganizationReviewerSummary;
  response?: OrganizationReviewResponse;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationReviewSummary {
  averageRating: number;
  reviewCount: number;
}

export interface OrganizationReviewPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListOrganizationReviewsResult {
  reviews: OrganizationReviewRecord[];
  summary: OrganizationReviewSummary;
  pagination: OrganizationReviewPagination;
}

export interface ListOrganizationReviewsInput
  extends ListOrganizationReviewsQuery {
  organizationId: string;
}

export interface UpsertOrganizationReviewInput
  extends CreateOrganizationReviewBody {
  organizationId: string;
  reviewerId: string;
}

export interface DeleteOwnOrganizationReviewInput {
  organizationId: string;
  reviewerId: string;
}

export interface ReplyOrganizationReviewInput
  extends ReplyOrganizationReviewBody {
  organizationId: string;
  actorUserId: string;
  reviewId: string;
}

export interface RemoveOrganizationReviewReplyInput {
  organizationId: string;
  actorUserId: string;
  reviewId: string;
}

export interface DeleteOrganizationReviewInput {
  organizationId: string;
  actorUserId: string;
  reviewId: string;
}

export interface DeleteOrganizationReviewResult {
  deleted: true;
  reviewId: string;
}

export interface UpsertOrganizationReviewPersistence {
  organizationId: string;
  reviewerId: string;
  rating: number;
  title: string | null;
  comment: string | null;
}

export interface SetOrganizationReviewResponsePersistence {
  response: string | null;
  responseAuthorId: string | null;
  respondedAt: Date | null;
}
