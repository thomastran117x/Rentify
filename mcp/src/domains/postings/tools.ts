import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  RentifyApiClient,
  type CreatePostingBody,
  type ListMyPostingsQuery,
  type PostingAnalyticsDetailQuery,
  type PostingAnalyticsListQuery,
  type PostingAvailabilityBlockBody,
  type PostingReviewBody,
  type UpdatePostingBody,
} from "../../integrations/rentify-api/client.js";
import { executeTool } from "../shared/tool-results.js";

const postingVariantSchema = {
  family: z.enum(["place", "equipment", "vehicle"]),
  subtype: z.string().trim().min(1).max(50),
};

const pricingSchema = {
  currency: z.string().trim().length(3),
  daily: z.object({
    amount: z.number().positive(),
  }),
  hourly: z
    .object({
      amount: z.number().positive(),
    })
    .optional(),
  weekly: z
    .object({
      amount: z.number().positive(),
    })
    .optional(),
  monthly: z
    .object({
      amount: z.number().positive(),
    })
    .optional(),
};

const photoSchema = z.object({
  blobUrl: z.string().url(),
  blobName: z.string().trim().min(1).max(1024),
  position: z.number().int().min(0).max(9),
});

const detailValueSchema = z.union([
  z.string().trim().min(1).max(100),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().trim().min(1).max(100)).max(20),
]);

const locationSchema = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  city: z.string().trim().min(1).max(120),
  region: z.string().trim().min(1).max(120),
  country: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().min(1).max(32).nullable().optional(),
};

const availabilityBlockSchema = {
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  note: z.string().trim().min(1).max(255).nullable().optional(),
};

const postingReviewSchema = {
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(120).nullable().optional(),
  comment: z.string().trim().min(1).max(2000).nullable().optional(),
};

const postingWriteSchemaShape = {
  variant: z.object(postingVariantSchema),
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(5000),
  pricing: z.object(pricingSchema),
  photos: z.array(photoSchema).min(1).max(10),
  tags: z.array(z.string().trim().min(1).max(50)).max(30),
  details: z.record(z.string().trim().min(1).max(50), detailValueSchema),
  availabilityStatus: z.enum(["available", "limited", "unavailable"]),
  availabilityNotes: z.string().trim().min(1).max(500).nullable().optional(),
  maxBookingDurationDays: z.number().int().min(1).max(365).nullable().optional(),
  location: z.object(locationSchema),
};

export interface GetMyPostingToolArgs {
  id: string;
}

export interface ListMyPostingsToolArgs extends ListMyPostingsQuery {}

export interface BatchGetMyPostingsToolArgs {
  ids: string[];
}

export interface CreatePostingToolArgs extends CreatePostingBody {}

export interface UpdatePostingToolArgs extends UpdatePostingBody {
  id: string;
}

export interface ListPostingAvailabilityBlocksToolArgs {
  id: string;
}

export interface CreatePostingAvailabilityBlockToolArgs extends PostingAvailabilityBlockBody {
  id: string;
}

export interface UpdatePostingAvailabilityBlockToolArgs extends PostingAvailabilityBlockBody {
  id: string;
  blockId: string;
}

export interface DeletePostingAvailabilityBlockToolArgs {
  id: string;
  blockId: string;
}

export interface GetPostingsAnalyticsSummaryToolArgs {
  window?: "7d" | "30d" | "all";
}

export interface ListPostingsAnalyticsToolArgs extends PostingAnalyticsListQuery {}

export interface GetPostingAnalyticsToolArgs extends PostingAnalyticsDetailQuery {
  id: string;
}

export interface CreatePostingReviewToolArgs extends PostingReviewBody {
  id: string;
}

export interface UpdateMyPostingReviewToolArgs extends PostingReviewBody {
  id: string;
}

function readArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function readPostingName(value: Record<string, unknown>): string | undefined {
  return typeof value.name === "string" ? value.name : undefined;
}

function readWindow(value: Record<string, unknown>): string | undefined {
  return typeof value.window === "string" ? value.window : undefined;
}

export function createPostingsToolHandlers(apiClient: RentifyApiClient) {
  return {
    getMyPosting: (args: GetMyPostingToolArgs) =>
      executeTool(
        () => apiClient.getMyPosting(args.id),
        (result) =>
          `Fetched your posting ${result.id}${result.name ? ` (${result.name})` : ""}.`,
      ),
    listMyPostings: (args: ListMyPostingsToolArgs) =>
      executeTool(
        () => apiClient.listMyPostings(args),
        (result) =>
          `Fetched ${result.postings.length} of your posting(s) on page ${result.pagination.page}.`,
      ),
    batchGetMyPostings: (args: BatchGetMyPostingsToolArgs) =>
      executeTool(
        () => apiClient.batchGetMyPostings(args.ids),
        (result) =>
          `Fetched ${result.postings.length} of your posting(s); ${result.missingIds.length} id(s) were not found.`,
      ),
    createPosting: (args: CreatePostingToolArgs) =>
      executeTool(
        () => apiClient.createPosting(args),
        (result) =>
          `Created posting ${result.id}${readPostingName(result) ? ` (${readPostingName(result)})` : ""}.`,
      ),
    updatePosting: (args: UpdatePostingToolArgs) =>
      executeTool(
        () =>
          apiClient.updatePosting(args.id, {
            variant: args.variant,
            name: args.name,
            description: args.description,
            pricing: args.pricing,
            photos: args.photos,
            tags: args.tags,
            details: args.details,
            availabilityStatus: args.availabilityStatus,
            availabilityNotes: args.availabilityNotes,
            maxBookingDurationDays: args.maxBookingDurationDays,
            location: args.location,
          }),
        (result) =>
          `Updated posting ${result.id}${readPostingName(result) ? ` (${readPostingName(result)})` : ""}.`,
      ),
    duplicatePosting: (args: GetMyPostingToolArgs) =>
      executeTool(
        () => apiClient.duplicatePosting(args.id),
        (result) =>
          `Duplicated posting into ${result.id}${readPostingName(result) ? ` (${readPostingName(result)})` : ""}.`,
      ),
    publishPosting: (args: GetMyPostingToolArgs) =>
      executeTool(
        () => apiClient.publishPosting(args.id),
        (result) => `Published posting ${result.id}.`,
      ),
    pausePosting: (args: GetMyPostingToolArgs) =>
      executeTool(
        () => apiClient.pausePosting(args.id),
        (result) => `Paused posting ${result.id}.`,
      ),
    unpausePosting: (args: GetMyPostingToolArgs) =>
      executeTool(
        () => apiClient.unpausePosting(args.id),
        (result) => `Unpaused posting ${result.id}.`,
      ),
    archivePosting: (args: GetMyPostingToolArgs) =>
      executeTool(
        () => apiClient.archivePosting(args.id),
        (result) => `Archived posting ${result.id}.`,
      ),
    listPostingAvailabilityBlocks: (args: ListPostingAvailabilityBlocksToolArgs) =>
      executeTool(
        () => apiClient.listPostingAvailabilityBlocks(args.id),
        (result) =>
          `Fetched ${result.availabilityBlocks.length} availability block(s) for posting ${args.id}.`,
      ),
    createPostingAvailabilityBlock: (args: CreatePostingAvailabilityBlockToolArgs) =>
      executeTool(
        () =>
          apiClient.createPostingAvailabilityBlock(args.id, {
            startAt: args.startAt,
            endAt: args.endAt,
            note: args.note,
          }),
        (result) => `Created availability block ${result.id} for posting ${args.id}.`,
      ),
    updatePostingAvailabilityBlock: (args: UpdatePostingAvailabilityBlockToolArgs) =>
      executeTool(
        () =>
          apiClient.updatePostingAvailabilityBlock(args.id, args.blockId, {
            startAt: args.startAt,
            endAt: args.endAt,
            note: args.note,
          }),
        (result) => `Updated availability block ${result.id} for posting ${args.id}.`,
      ),
    deletePostingAvailabilityBlock: (args: DeletePostingAvailabilityBlockToolArgs) =>
      executeTool(
        async () => {
          await apiClient.deletePostingAvailabilityBlock(args.id, args.blockId);
          return {
            deleted: true,
            postingId: args.id,
            blockId: args.blockId,
          };
        },
        () => `Deleted availability block ${args.blockId} for posting ${args.id}.`,
      ),
    getPostingsAnalyticsSummary: (args: GetPostingsAnalyticsSummaryToolArgs) =>
      executeTool(
        () => apiClient.getPostingsAnalyticsSummary(args.window),
        (result) =>
          `Fetched posting analytics summary for window ${readWindow(result) ?? args.window ?? "7d"}.`,
      ),
    listPostingsAnalytics: (args: ListPostingsAnalyticsToolArgs) =>
      executeTool(
        () => apiClient.listPostingsAnalytics(args),
        (result) =>
          `Fetched analytics for ${result.postings.length} posting(s) in window ${readWindow(result) ?? args.window ?? "7d"}.`,
      ),
    getPostingAnalytics: (args: GetPostingAnalyticsToolArgs) =>
      executeTool(
        () =>
          apiClient.getPostingAnalytics(args.id, {
            window: args.window,
            granularity: args.granularity,
          }),
        (result) =>
          `Fetched analytics for posting ${result.postingId} with ${readArrayLength(result.buckets)} bucket(s).`,
      ),
    createPostingReview: (args: CreatePostingReviewToolArgs) =>
      executeTool(
        () =>
          apiClient.createPostingReview(args.id, {
            rating: args.rating,
            title: args.title,
            comment: args.comment,
          }),
        (result) => `Created review ${typeof result.id === "string" ? result.id : ""} for posting ${args.id}.`.trim(),
      ),
    updateMyPostingReview: (args: UpdateMyPostingReviewToolArgs) =>
      executeTool(
        () =>
          apiClient.updateMyPostingReview(args.id, {
            rating: args.rating,
            title: args.title,
            comment: args.comment,
          }),
        (result) => `Updated your review ${typeof result.id === "string" ? result.id : ""} for posting ${args.id}.`.trim(),
      ),
  };
}

export function registerPostingsTools(
  server: McpServer,
  handlers: ReturnType<typeof createPostingsToolHandlers>,
): void {
  server.registerTool(
    "get_my_posting",
    {
      title: "Get My Posting",
      description: "Fetch one of your postings, including drafts and unpublished states.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
    },
    handlers.getMyPosting,
  );

  server.registerTool(
    "list_my_postings",
    {
      title: "List My Postings",
      description: "List your postings with optional status filtering.",
      inputSchema: {
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
        status: z.enum(["draft", "published", "paused", "archived"]).optional(),
      },
    },
    handlers.listMyPostings,
  );

  server.registerTool(
    "batch_get_my_postings",
    {
      title: "Batch Get My Postings",
      description: "Fetch multiple postings from your account by id.",
      inputSchema: {
        ids: z.array(z.string().trim().min(1)).min(1).max(50),
      },
    },
    handlers.batchGetMyPostings,
  );

  server.registerTool(
    "create_posting",
    {
      title: "Create Posting",
      description: "Create a new draft posting in your account.",
      inputSchema: {
        ...postingWriteSchemaShape,
        availabilityBlocks: z.array(z.object(availabilityBlockSchema)).max(200),
      },
    },
    handlers.createPosting,
  );

  server.registerTool(
    "update_posting",
    {
      title: "Update Posting",
      description: "Update an existing posting. Availability blocks are managed separately.",
      inputSchema: {
        id: z.string().trim().min(1),
        ...postingWriteSchemaShape,
      },
    },
    handlers.updatePosting,
  );

  server.registerTool(
    "duplicate_posting",
    {
      title: "Duplicate Posting",
      description: "Duplicate an existing posting into a new draft.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
    },
    handlers.duplicatePosting,
  );

  server.registerTool(
    "publish_posting",
    {
      title: "Publish Posting",
      description: "Publish a draft posting.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
    },
    handlers.publishPosting,
  );

  server.registerTool(
    "pause_posting",
    {
      title: "Pause Posting",
      description: "Pause a published posting.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
    },
    handlers.pausePosting,
  );

  server.registerTool(
    "unpause_posting",
    {
      title: "Unpause Posting",
      description: "Return a paused posting to published status.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
    },
    handlers.unpausePosting,
  );

  server.registerTool(
    "archive_posting",
    {
      title: "Archive Posting",
      description: "Archive a posting you no longer want active.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
    },
    handlers.archivePosting,
  );

  server.registerTool(
    "list_posting_availability_blocks",
    {
      title: "List Posting Availability Blocks",
      description: "List owner-managed availability blocks for one of your postings.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
    },
    handlers.listPostingAvailabilityBlocks,
  );

  server.registerTool(
    "create_posting_availability_block",
    {
      title: "Create Posting Availability Block",
      description: "Create an availability block for one of your postings.",
      inputSchema: {
        id: z.string().trim().min(1),
        ...availabilityBlockSchema,
      },
    },
    handlers.createPostingAvailabilityBlock,
  );

  server.registerTool(
    "update_posting_availability_block",
    {
      title: "Update Posting Availability Block",
      description: "Update one owner-managed availability block.",
      inputSchema: {
        id: z.string().trim().min(1),
        blockId: z.string().trim().min(1),
        ...availabilityBlockSchema,
      },
    },
    handlers.updatePostingAvailabilityBlock,
  );

  server.registerTool(
    "delete_posting_availability_block",
    {
      title: "Delete Posting Availability Block",
      description: "Delete one owner-managed availability block.",
      inputSchema: {
        id: z.string().trim().min(1),
        blockId: z.string().trim().min(1),
      },
    },
    handlers.deletePostingAvailabilityBlock,
  );

  server.registerTool(
    "get_postings_analytics_summary",
    {
      title: "Get Postings Analytics Summary",
      description: "Fetch the analytics summary across your postings.",
      inputSchema: {
        window: z.enum(["7d", "30d", "all"]).optional(),
      },
    },
    handlers.getPostingsAnalyticsSummary,
  );

  server.registerTool(
    "list_postings_analytics",
    {
      title: "List Postings Analytics",
      description: "List per-posting analytics for your account.",
      inputSchema: {
        window: z.enum(["7d", "30d", "all"]).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
      },
    },
    handlers.listPostingsAnalytics,
  );

  server.registerTool(
    "get_posting_analytics",
    {
      title: "Get Posting Analytics",
      description: "Fetch analytics detail for one posting in your account.",
      inputSchema: {
        id: z.string().trim().min(1),
        window: z.enum(["7d", "30d", "all"]).optional(),
        granularity: z.enum(["hour", "day"]).optional(),
      },
    },
    handlers.getPostingAnalytics,
  );

  server.registerTool(
    "create_posting_review",
    {
      title: "Create Posting Review",
      description: "Create a review for a posting you are eligible to review.",
      inputSchema: {
        id: z.string().trim().min(1),
        ...postingReviewSchema,
      },
    },
    handlers.createPostingReview,
  );

  server.registerTool(
    "update_my_posting_review",
    {
      title: "Update My Posting Review",
      description: "Update your existing review for a posting.",
      inputSchema: {
        id: z.string().trim().min(1),
        ...postingReviewSchema,
      },
    },
    handlers.updateMyPostingReview,
  );
}
