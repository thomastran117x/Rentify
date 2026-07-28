import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostingReviewForm } from "./posting-review-form";

const { useAuthMock, getOwnReviewMock, createReviewMock, updateOwnReviewMock } =
  vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    getOwnReviewMock: vi.fn(),
    createReviewMock: vi.fn(),
    updateOwnReviewMock: vi.fn(),
  }));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/postings/api", () => ({
  postingsApi: {
    getOwnReview: getOwnReviewMock,
    createReview: createReviewMock,
    updateOwnReview: updateOwnReviewMock,
  },
}));

function buildReview(overrides: Record<string, unknown> = {}) {
  return {
    id: "review-1",
    postingId: "posting-1",
    reviewerId: "user-1",
    rating: 4,
    title: "Great kayak",
    comment: "Smooth pickup.",
    reviewer: { username: "renter-five" },
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PostingReviewForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: { user: { id: "user-1" } },
    });
    getOwnReviewMock.mockResolvedValue({ eligible: true, review: null });
    createReviewMock.mockResolvedValue(buildReview());
    updateOwnReviewMock.mockResolvedValue(buildReview({ rating: 5 }));
  });

  it("creates a review, normalizing blank optional fields to null", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<PostingReviewForm postingId="posting-1" onSaved={onSaved} />);

    const submit = await screen.findByRole("button", {
      name: "Submit review",
    });

    await user.click(screen.getByRole("radio", { name: "4 stars" }));
    await user.type(screen.getByLabelText("Review title"), "  Great kayak  ");
    await user.click(submit);

    await waitFor(() => {
      expect(createReviewMock).toHaveBeenCalledWith("posting-1", {
        rating: 4,
        title: "Great kayak",
        comment: null,
      });
    });

    expect(updateOwnReviewMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(buildReview());
    expect(await screen.findByText("Thanks for your review!")).toBeVisible();
  });

  it("opens in edit mode prefilled with the existing review and issues a PUT", async () => {
    const user = userEvent.setup();
    getOwnReviewMock.mockResolvedValue({
      eligible: true,
      review: buildReview(),
    });
    render(<PostingReviewForm postingId="posting-1" />);

    const submit = await screen.findByRole("button", {
      name: "Update review",
    });

    expect(screen.getByLabelText("Review title")).toHaveValue("Great kayak");
    expect(screen.getByLabelText("Review comment")).toHaveValue(
      "Smooth pickup.",
    );
    expect(screen.getByRole("radio", { name: "4 stars" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(screen.getByRole("radio", { name: "5 stars" }));
    await user.click(submit);

    await waitFor(() => {
      expect(updateOwnReviewMock).toHaveBeenCalledWith("posting-1", {
        rating: 5,
        title: "Great kayak",
        comment: "Smooth pickup.",
      });
    });

    expect(createReviewMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Your review was updated.")).toBeVisible();
  });

  it("blocks submission without a star rating", async () => {
    const user = userEvent.setup();
    render(<PostingReviewForm postingId="posting-1" />);

    await user.click(
      await screen.findByRole("button", { name: "Submit review" }),
    );

    expect(
      await screen.findByText("Please choose a star rating."),
    ).toBeVisible();
    expect(createReviewMock).not.toHaveBeenCalled();
  });

  it("surfaces a friendly message when the API rejects the review", async () => {
    const user = userEvent.setup();
    createReviewMock.mockRejectedValue(new Error("boom"));
    render(<PostingReviewForm postingId="posting-1" />);

    await user.click(await screen.findByRole("radio", { name: "3 stars" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect(
      await screen.findByText("We couldn't submit your review right now."),
    ).toBeVisible();
  });

  it("renders nothing when the viewer is not eligible", async () => {
    getOwnReviewMock.mockResolvedValue({ eligible: false, review: null });
    const { container } = render(<PostingReviewForm postingId="posting-1" />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("explains ineligibility when the call site asks for a notice", async () => {
    getOwnReviewMock.mockResolvedValue({ eligible: false, review: null });
    render(<PostingReviewForm postingId="posting-1" showIneligibleNotice />);

    expect(
      await screen.findByText(
        "You can review this posting once your rental is complete.",
      ),
    ).toBeVisible();
  });

  it("does not query the API for signed-out viewers", async () => {
    useAuthMock.mockReturnValue({ status: "unauthenticated", session: null });
    const { container } = render(<PostingReviewForm postingId="posting-1" />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
    expect(getOwnReviewMock).not.toHaveBeenCalled();
  });
});
