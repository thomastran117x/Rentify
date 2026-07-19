import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDeviceIdMock = vi.fn();
const getDevicePlatformMock = vi.fn();
const readStoredSessionMock = vi.fn();

vi.mock("@/lib/auth/device", () => ({
  getDeviceId: getDeviceIdMock,
  getDevicePlatform: getDevicePlatformMock,
}));

vi.mock("@/lib/auth/storage", () => ({
  readStoredSession: readStoredSessionMock,
}));

function jsonResponse(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      success: true,
      message: "ok",
      data,
      error: null,
      meta: { requestId: "request-1" },
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

const review = {
  id: "review-1",
  organizationId: "org-1",
  reviewerId: "user-1",
  rating: 5,
  reviewer: { username: "renter-two" },
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

describe("organizationsApi reviews", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    getDeviceIdMock.mockReturnValue("device-1");
    getDevicePlatformMock.mockReturnValue("web");
    readStoredSessionMock.mockReturnValue({
      accessToken: "org-access-token",
      device: { known: true, knownByIp: false },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user",
      },
    });
    document.cookie = "csrf_token=org-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists public reviews without pagination params for page one", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        reviews: [review],
        summary: { averageRating: 5, reviewCount: 1 },
        pagination: {
          page: 1,
          pageSize: 5,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.listPublicReviews("org-1", { pageSize: 5 });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/reviews?pageSize=5",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("creates a review with a POST request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(review, 201));
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.createReview("org-1", {
      rating: 5,
      title: "Great",
      comment: "Loved it",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/reviews",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          rating: 5,
          title: "Great",
          comment: "Loved it",
        }),
        headers: expect.objectContaining({
          authorization: "Bearer org-access-token",
        }),
      }),
    );
  });

  it("updates the viewer's own review with a PUT request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ...review, rating: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.updateOwnReview("org-1", { rating: 4 });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/reviews/me",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ rating: 4 }),
      }),
    );
  });

  it("deletes the viewer's own review", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ deleted: true, reviewId: "review-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.deleteOwnReview("org-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/reviews/me",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("replies to a review with a PUT request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(review));
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.replyToReview("org-1", "review-1", "Thanks!");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/reviews/review-1/reply",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ body: "Thanks!" }),
      }),
    );
  });

  it("removes a review reply and deletes a review as moderation", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(review));
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.removeReviewReply("org-1", "review-1");
    await organizationsApi.deleteReview("org-1", "review-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8040/api/v1/organizations/org-1/reviews/review-1/reply",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8040/api/v1/organizations/org-1/reviews/review-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
