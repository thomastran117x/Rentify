import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationReviewsSection } from "./organization-reviews-section";

const { authMock, listMock, ownMock, createMock, updateMock, deleteMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    listMock: vi.fn(),
    ownMock: vi.fn(),
    createMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
  }));
vi.mock("@/components/auth/auth-context", () => ({ useAuth: authMock }));
vi.mock("@/lib/organizations/api", () => ({
  organizationsApi: {
    listPublicReviews: listMock,
    getOwnReview: ownMock,
    createReview: createMock,
    updateOwnReview: updateMock,
    deleteOwnReview: deleteMock,
  },
}));
vi.mock("@/components/common/pagination", () => ({
  Pagination: () => <div>Pagination</div>,
}));
vi.mock("@/components/reviews/star-rating", () => ({
  StarRating: () => <span>Stars</span>,
  StarRatingInput: ({ onChange }: { onChange: (value: number) => void }) => (
    <button type="button" onClick={() => onChange(5)}>
      Choose five stars
    </button>
  ),
}));
vi.mock("@/components/organizations/organization-public-visuals", () => ({
  formatOrganizationDate: () => "Today",
}));
vi.mock("@/lib/api/user-messages", () => ({
  getApiErrorMessage: () => "Review unavailable",
}));

const pagination = {
  page: 1,
  pageSize: 5,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
};
const review = {
  id: "review-1",
  organizationId: "org-1",
  reviewerId: "user-1",
  rating: 5,
  title: "Excellent",
  comment: "Great service",
  reviewer: { username: "renter" },
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const response = (reviews = [review]) => ({
  reviews,
  summary: { averageRating: 5, reviewCount: reviews.length },
  pagination,
});

describe("OrganizationReviewsSection", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders public reviews and prompts anonymous visitors to sign in", async () => {
    authMock.mockReturnValue({ status: "anonymous", session: null });
    listMock.mockResolvedValue(response());
    render(<OrganizationReviewsSection organizationId="org-1" />);
    await screen.findByText("Excellent");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(listMock).toHaveBeenCalledWith("org-1", { page: 1, pageSize: 5 });
  });

  it("validates, creates, updates, and removes an authenticated review", async () => {
    authMock.mockReturnValue({
      status: "authenticated",
      session: { user: { id: "user-1" } },
    });
    listMock.mockResolvedValue(response([]));
    ownMock.mockResolvedValue(null);
    createMock.mockResolvedValue(review);
    deleteMock.mockResolvedValue({ deleted: true });
    render(<OrganizationReviewsSection organizationId="org-1" />);
    await screen.findByText(
      "No reviews yet. Be the first to share your experience.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    expect(
      screen.getByText("Please choose a star rating."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose five stars" }));
    fireEvent.change(screen.getByPlaceholderText("Add a title (optional)"), {
      target: { value: " Excellent " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith("org-1", {
        rating: 5,
        title: "Excellent",
        comment: null,
      }),
    );
    await screen.findByText("Thanks for your review!");
    fireEvent.click(screen.getByRole("button", { name: "Remove review" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("org-1"));
    await screen.findByText("Your review was removed.");
  });
});
