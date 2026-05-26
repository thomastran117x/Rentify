import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostingDetailClient } from "./posting-detail-client";

const { fetchPublicPostingReviewsMock } = vi.hoisted(() => ({
  fetchPublicPostingReviewsMock: vi.fn(),
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

vi.mock("@/lib/postings/public", async () => {
  const actual = await vi.importActual<typeof import("@/lib/postings/public")>(
    "@/lib/postings/public",
  );

  return {
    ...actual,
    fetchPublicPostingReviews: fetchPublicPostingReviewsMock,
  };
});

describe("PostingDetailClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("renders posting, owner, and review report actions", async () => {
    render(
      <PostingDetailClient
        posting={{
          id: "posting-1",
          ownerId: "owner-1",
          owner: {
            id: "owner-1",
            username: "owner-one",
            role: "owner",
          },
          status: "published",
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
          availabilityStatus: "available",
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
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Report posting" }),
    ).toBeInTheDocument();

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
});
