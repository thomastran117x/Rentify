import {
  BackendApiError,
} from "../../integrations/rentify-api/index.js";
import { createPostingsToolHandlers } from "../../domains/postings/index.js";
import type { CreatePostingBody } from "../../integrations/rentify-api/client.js";

function readFirstText(result: { content: Array<{ type: string } & Record<string, unknown>> }): string {
  const textBlock = result.content.find(
    (entry): entry is { type: "text"; text: string } => entry.type === "text",
  );

  return textBlock?.text ?? "";
}

function createPostingBody(): CreatePostingBody {
  return {
    variant: {
      family: "equipment",
      subtype: "camera",
    },
    name: "Camera Kit",
    description: "Mirrorless camera with two lenses.",
    pricing: {
      currency: "CAD",
      daily: {
        amount: 55,
      },
    },
    photos: [
      {
        blobUrl: "https://example.com/photo.jpg",
        blobName: "postings/camera/photo.jpg",
        position: 0,
      },
    ],
    tags: ["camera", "photo"],
    details: {
      condition: "excellent",
    },
    availabilityStatus: "available",
    availabilityBlocks: [],
    location: {
      latitude: 43.7,
      longitude: -79.4,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    },
  };
}

describe("createPostingsToolHandlers", () => {
  it("maps list_my_postings to the protected owner postings API", async () => {
    const apiClient = {
      listMyPostings: jest.fn().mockResolvedValue({
        postings: [{ id: "post_1", name: "Camera Kit" }],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
    } as never;
    const handlers = createPostingsToolHandlers(apiClient);

    const result = await handlers.listMyPostings({
      status: "draft",
    });

    expect((apiClient as { listMyPostings: jest.Mock }).listMyPostings).toHaveBeenCalledWith({
      status: "draft",
    });
    expect(result.structuredContent).toMatchObject({
      postings: [{ id: "post_1" }],
    });
    expect(readFirstText(result)).toContain("Fetched 1 of your posting(s)");
  });

  it("maps create_posting to the protected draft creation API", async () => {
    const apiClient = {
      createPosting: jest.fn().mockResolvedValue({
        id: "post_1",
        name: "Camera Kit",
        status: "draft",
      }),
    } as never;
    const handlers = createPostingsToolHandlers(apiClient);
    const body = createPostingBody();

    const result = await handlers.createPosting(body);

    expect((apiClient as { createPosting: jest.Mock }).createPosting).toHaveBeenCalledWith(body);
    expect(result.structuredContent).toMatchObject({
      id: "post_1",
      status: "draft",
    });
    expect(readFirstText(result)).toContain("Created posting post_1");
  });

  it("maps get_postings_analytics_summary to the analytics summary API", async () => {
    const apiClient = {
      getPostingsAnalyticsSummary: jest.fn().mockResolvedValue({
        window: "30d",
        totals: {
          views: 42,
        },
      }),
    } as never;
    const handlers = createPostingsToolHandlers(apiClient);

    const result = await handlers.getPostingsAnalyticsSummary({
      window: "30d",
    });

    expect((apiClient as { getPostingsAnalyticsSummary: jest.Mock }).getPostingsAnalyticsSummary).toHaveBeenCalledWith(
      "30d",
    );
    expect(result.structuredContent).toMatchObject({
      window: "30d",
      totals: {
        views: 42,
      },
    });
    expect(readFirstText(result)).toContain("window 30d");
  });

  it("maps delete_posting_availability_block to a delete call and returns a synthetic result", async () => {
    const apiClient = {
      deletePostingAvailabilityBlock: jest.fn().mockResolvedValue(undefined),
    } as never;
    const handlers = createPostingsToolHandlers(apiClient);

    const result = await handlers.deletePostingAvailabilityBlock({
      id: "post_1",
      blockId: "block_1",
    });

    expect((apiClient as { deletePostingAvailabilityBlock: jest.Mock }).deletePostingAvailabilityBlock).toHaveBeenCalledWith(
      "post_1",
      "block_1",
    );
    expect(result.structuredContent).toMatchObject({
      deleted: true,
      postingId: "post_1",
      blockId: "block_1",
    });
  });

  it("returns isError results for protected postings API failures", async () => {
    const apiClient = {
      publishPosting: jest
        .fn()
        .mockRejectedValue(
          new BackendApiError(
            403,
            "FORBIDDEN",
            { requiredScope: "mcp:write" },
            "Personal access token does not include the required scope.",
          ),
        ),
    } as never;
    const handlers = createPostingsToolHandlers(apiClient);

    const result = await handlers.publishPosting({
      id: "post_1",
    });

    expect(result.isError).toBe(true);
    expect(readFirstText(result)).toContain("\"status\": 403");
    expect(readFirstText(result)).toContain("\"code\": \"FORBIDDEN\"");
  });
});
