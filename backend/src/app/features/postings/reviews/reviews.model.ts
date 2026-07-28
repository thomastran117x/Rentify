import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/features/postings/postings.model";

const optionalReviewTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .nullable()
  .optional();

export const createPostingReviewRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(120).nullable().optional(),
  comment: optionalReviewTextSchema,
});

export const updatePostingReviewRequestSchema =
  createPostingReviewRequestSchema;

export const listPostingReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type CreatePostingReviewRequestBody = z.infer<
  typeof createPostingReviewRequestSchema
>;
export type UpdatePostingReviewRequestBody = z.infer<
  typeof updatePostingReviewRequestSchema
>;
export type ListPostingReviewsQuery = z.infer<
  typeof listPostingReviewsQuerySchema
>;

export interface PostingReviewRecord {
  id: string;
  postingId: string;
  reviewerId: string;
  rating: number;
  title?: string;
  comment?: string;
  reviewer: {
    username?: string;
    avatarUrl?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PostingReviewSummary {
  averageRating: number;
  reviewCount: number;
}

export interface ListPostingReviewsResult {
  reviews: PostingReviewRecord[];
  summary: PostingReviewSummary;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface GetOwnPostingReviewResult {
  eligible: boolean;
  review: PostingReviewRecord | null;
}

export interface UpsertPostingReviewInput {
  postingId: string;
  reviewerId: string;
  rating: number;
  title?: string | null;
  comment?: string | null;
}
