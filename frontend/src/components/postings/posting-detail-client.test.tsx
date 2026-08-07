import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostingDetailClient } from "./posting-detail-client";

const {
  fetchPublicPostingReviewsMock,
  getOwnReviewMock,
  createReviewMock,
  updateOwnReviewMock,
} = vi.hoisted(() => ({
  fetchPublicPostingReviewsMock: vi.fn(),
  getOwnReviewMock: vi.fn(),
  createReviewMock: vi.fn(),
  updateOwnReviewMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  usePathname: () => "/postings/posting-1",
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: () => ({
    status: "authenticated",
    session: {
      user: {
        role: "user",
      },
    },
  }),
}));

vi.mock("@/components/postings/saved-postings-context", () => ({
  useSavedPostings: () => ({
    status: "ready",
    truncated: false,
    isSaved: () => false,
    isPending: () => false,
    toggleSaved: vi.fn(),
    refresh: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  }),
}));

vi.mock("@/lib/postings/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/postings/api")>(
      "@/lib/postings/api",
    );

  return {
    ...actual,
    postingsApi: {
      ...actual.postingsApi,
      getOwnReview: getOwnReviewMock,
      createReview: createReviewMock,
      updateOwnReview: updateOwnReviewMock,
    },
  };
});

vi.mock("@/lib/postings/public", async () => {
  const actual = await vi.importActual<typeof import("@/lib/postings/public")>(
    "@/lib/postings/public",
  );

  return {
    ...actual,
    fetchPublicPostingReviews: fetchPublicPostingReviewsMock,
  };
});

function buildPosting() {
  return {
    id: "posting-1",
    organizationId: "org-1",
    organization: {
      id: "org-1",
      name: "Owner One Organization",
    },
    status: "published" as const,
    variant: {
      family: "place",
      subtype: "workspace",
    },
    name: "Studio Loft",
    description: "Bright workspace in the city core.",
    pricing: {
      currency: "CAD",
      daily: {
        amount: 145,
      },
    },
    pricingCurrency: "CAD",
    photos: [],
    tags: ["wifi"],
    details: {
      guest_capacity: 12,
    },
    availabilityStatus: "available" as const,
    effectiveMaxBookingDurationDays: 7,
    availabilityBlocks: [],
    location: {
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      latitude: 43.65,
      longitude: -79.38,
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

describe("PostingDetailClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOwnReviewMock.mockResolvedValue({ eligible: false, review: null });
    fetchPublicPostingReviewsMock.mockResolvedValue({
      reviews: [
        {
          id: "review-1",
          postingId: "posting-1",
          reviewerId: "user-2",
          rating: 5,
          title: "Excellent stay",
          comment: "Everything matched the photos.",
          reviewer: {
            username: "renter-two",
          },
          createdAt: "2026-05-20T12:00:00.000Z",
          updatedAt: "2026-05-20T12:00:00.000Z",
        },
      ],
      summary: {
        averageRating: 5,
        reviewCount: 1,
      },
      pagination: {
        page: 1,
        pageSize: 5,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  });

  it("renders posting, organization, and review report actions", async () => {
    render(<PostingDetailClient posting={buildPosting()} />);

    expect(
      screen.getAllByRole("button", { name: "Report posting" }).length,
    ).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText("Excellent stay")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Report review" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Report user" }).length,
    ).toBeGreaterThan(0);
  });

  it("hides the review form from viewers without a completed renting", async () => {
    render(<PostingDetailClient posting={buildPosting()} />);

    await waitFor(() => {
      expect(getOwnReviewMock).toHaveBeenCalledWith("posting-1");
    });

    expect(
      screen.queryByRole("button", { name: "Submit review" }),
    ).not.toBeInTheDocument();
  });

  it("lets an eligible renter submit a review and refreshes the list", async () => {
    const user = userEvent.setup();
    getOwnReviewMock.mockResolvedValue({ eligible: true, review: null });
    createReviewMock.mockResolvedValue({
      id: "review-2",
      postingId: "posting-1",
      reviewerId: "user-1",
      rating: 5,
      reviewer: {},
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    render(<PostingDetailClient posting={buildPosting()} />);

    const submit = await screen.findByRole("button", { name: "Submit review" });
    await waitFor(() => {
      expect(fetchPublicPostingReviewsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("radio", { name: "5 stars" }));
    await user.click(submit);

    await waitFor(() => {
      expect(createReviewMock).toHaveBeenCalledWith("posting-1", {
        rating: 5,
        title: null,
        comment: null,
      });
    });

    // The summary and list come from the reviews endpoint, so a successful
    // save has to refetch page 1 for the new review to appear.
    await waitFor(() => {
      expect(fetchPublicPostingReviewsMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchPublicPostingReviewsMock).toHaveBeenLastCalledWith(
      "posting-1",
      1,
      5,
    );
  });
});
