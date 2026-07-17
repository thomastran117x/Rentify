import { z } from "zod";
import { organizationResourceIdSchema } from "@/features/organizations/organizations.model";

export const organizationBlogStatusSchema = z.enum(["draft", "published"]);
export type OrganizationBlogStatus = z.infer<
  typeof organizationBlogStatusSchema
>;

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(220)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug may only contain lowercase letters, numbers, and single hyphens.",
  );

const coverImageUrlSchema = z.string().trim().url().max(1024);
const coverImageBlobNameSchema = z.string().trim().min(1).max(1024);

const tagsSchema = z
  .array(z.string().trim().min(1, "Tags cannot be empty.").max(40))
  .max(10, "A blog post can have at most 10 tags.");

const excerptSchema = z.string().trim().max(300);

export const createOrganizationBlogSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200),
    // Rich-text HTML from the editor. Sanitized server-side before persistence.
    body: z.string().trim().min(1, "Body is required.").max(100000),
    excerpt: excerptSchema.nullish(),
    slug: slugSchema.optional(),
    coverImageUrl: coverImageUrlSchema.nullable().optional(),
    coverImageBlobName: coverImageBlobNameSchema.nullable().optional(),
    tags: tagsSchema.optional(),
    status: organizationBlogStatusSchema.default("draft"),
  })
  .strict();

export const updateOrganizationBlogSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200).optional(),
    body: z.string().trim().min(1, "Body is required.").max(100000).optional(),
    excerpt: excerptSchema.nullable().optional(),
    slug: slugSchema.optional(),
    coverImageUrl: coverImageUrlSchema.nullable().optional(),
    coverImageBlobName: coverImageBlobNameSchema.nullable().optional(),
    tags: tagsSchema.optional(),
    status: organizationBlogStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

export const listOrganizationBlogQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    status: organizationBlogStatusSchema.optional(),
    tag: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export const listPublicOrganizationBlogQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    tag: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export const organizationBlogIdSchema = organizationResourceIdSchema;
export const organizationBlogSlugSchema = slugSchema;

export type CreateOrganizationBlogBody = z.infer<
  typeof createOrganizationBlogSchema
>;
export type UpdateOrganizationBlogBody = z.infer<
  typeof updateOrganizationBlogSchema
>;
export type ListOrganizationBlogQuery = z.infer<
  typeof listOrganizationBlogQuerySchema
>;
export type ListPublicOrganizationBlogQuery = z.infer<
  typeof listPublicOrganizationBlogQuerySchema
>;

export interface OrganizationBlogAuthorSummary {
  id: string;
  email: string;
  username: string;
  avatarUrl?: string;
}

export interface OrganizationBlogPostRecord {
  id: string;
  organizationId: string;
  author?: OrganizationBlogAuthorSummary;
  title: string;
  slug: string;
  excerpt?: string;
  body: string;
  coverImageUrl?: string;
  coverImageBlobName?: string;
  tags: string[];
  status: OrganizationBlogStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationBlogPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListOrganizationBlogPostsResult {
  posts: OrganizationBlogPostRecord[];
  pagination: OrganizationBlogPagination;
}

export interface ListOrganizationBlogPostsInput
  extends ListOrganizationBlogQuery {
  organizationId: string;
  actorUserId: string;
}

export interface ListPublicOrganizationBlogPostsInput
  extends ListPublicOrganizationBlogQuery {
  organizationId: string;
}

export interface GetPublicOrganizationBlogPostInput {
  organizationId: string;
  slug: string;
}

export interface CreateOrganizationBlogPostInput
  extends CreateOrganizationBlogBody {
  organizationId: string;
  actorUserId: string;
}

export interface UpdateOrganizationBlogPostInput
  extends UpdateOrganizationBlogBody {
  organizationId: string;
  actorUserId: string;
  blogPostId: string;
}

export interface DeleteOrganizationBlogPostInput {
  organizationId: string;
  actorUserId: string;
  blogPostId: string;
}

export interface DeleteOrganizationBlogPostResult {
  deleted: true;
  blogPostId: string;
}

export interface CreateOrganizationBlogPostPersistence {
  organizationId: string;
  authorUserId: string | null;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  coverImageUrl: string | null;
  coverImageBlobName: string | null;
  tags: string[];
  status: OrganizationBlogStatus;
  publishedAt: Date | null;
}

export interface UpdateOrganizationBlogPostPersistence {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  body?: string;
  coverImageUrl?: string | null;
  coverImageBlobName?: string | null;
  tags?: string[];
  status?: OrganizationBlogStatus;
  publishedAt?: Date | null;
}
