import { z } from "zod";
import { organizationResourceIdSchema } from "@/features/organizations/organizations.model";

export const organizationBlogStatusSchema = z.enum(["draft", "published"]);
export type OrganizationBlogStatus = z.infer<
  typeof organizationBlogStatusSchema
>;

// Ordering options for the public (Elasticsearch-backed) blog reads. "relevance"
// only differs from "newest" when a free-text query is present.
export const organizationBlogSortSchema = z.enum([
  "relevance",
  "newest",
  "oldest",
]);
export type OrganizationBlogSort = z.infer<typeof organizationBlogSortSchema>;

// Where a public blog list result was served from. Elasticsearch is the primary
// path; the database fallback keeps blogs readable when the cluster is down.
export type OrganizationBlogSearchSource = "elasticsearch" | "database";

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
    // Free-text query for the Elasticsearch-backed per-organization blog feed.
    q: z.string().trim().min(1).max(200).optional(),
    sort: organizationBlogSortSchema.optional(),
  })
  .strict();

// Global (cross-organization) published blog feed/search. Same shape as the
// per-org query but not scoped to a single organization.
export const listPublicBlogFeedQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    tag: z.string().trim().min(1).max(40).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    sort: organizationBlogSortSchema.optional(),
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
export type ListPublicBlogFeedQuery = z.infer<
  typeof listPublicBlogFeedQuerySchema
>;

export interface OrganizationBlogAuthorSummary {
  id: string;
  email: string;
  username: string;
  avatarUrl?: string;
}

// Minimal organization identity attached to a blog post when it is surfaced
// outside of a single organization context (e.g. the global blog feed), so the
// UI can label and link the post back to its organization.
export interface OrganizationBlogOrganizationSummary {
  id: string;
  name: string;
  logoUrl?: string;
}

export interface OrganizationBlogPostRecord {
  id: string;
  organizationId: string;
  organization?: OrganizationBlogOrganizationSummary;
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
  // Present on public (Elasticsearch-backed) reads to indicate where the result
  // was served from and echo the free-text query that produced it.
  source?: OrganizationBlogSearchSource;
  query?: string;
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

export interface ListPublicBlogFeedInput extends ListPublicBlogFeedQuery {}

// The subset of blog fields projected into Elasticsearch. Kept lean: display
// data (author, cover image, organization) is hydrated from the database at read
// time, so the index only carries what we search, filter, and sort on. `body` is
// stored as plain text (HTML stripped) for full-text relevance.
export interface OrganizationBlogSearchDocument {
  id: string;
  organizationId: string;
  title: string;
  excerpt: string | null;
  body: string;
  tags: string[];
  status: OrganizationBlogStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationBlogSearchOutboxRecord {
  id: string;
  blogPostId?: string;
  reindexRunId?: string;
  operation: "upsert" | "delete" | "barrier";
  dedupeKey: string;
  targetIndexName?: string;
  attempts: number;
  publishAttempts: number;
  availableAt: string;
  processingAt?: string;
  publishedAt?: string;
  indexedAt?: string;
  deadLetteredAt?: string;
  brokerMessageId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
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
