import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  BookingCancellationQuoteResult,
  BookingDashboardItem,
} from "@/lib/bookings/types";
import {
  BookingItemCard,
  bannerClasses,
  canLeaveReview,
  canOpenDispute,
  canReviewCancellation,
  humanizeActionNeeded,
  urgencyClasses,
} from "./bookings-dashboard";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/reviews/posting-review-form", () => ({
  PostingReviewForm: ({ postingId }: { postingId: string }) => (
    <div>Review form for {postingId}</div>
  ),
}));

function item(overrides: Partial<BookingDashboardItem> = {}): BookingDashboardItem {
  return {
    id: "item-1",
    kind: "booking_request",
    bookingRequestId: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    organizationId: "org-1",
    status: "approved",
    sourceStatus: "approved",
    startAt: "2026-08-01T15:00:00.000Z",
    endAt: "2026-08-04T11:00:00.000Z",
    durationDays: 3,
    guestCount: 2,
    pricingCurrency: "USD",
    dailyPriceAmount: 125,
    estimatedTotal: 375,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    posting: {
      id: "posting-1",
      name: "Lake House",
      effectiveMaxBookingDurationDays: 14,
    },
    isExpiringHold: false,
    nextAction: { code: "monitor", label: "Monitor stay" },
    urgency: { level: "none", rank: 4, isActionable: false, label: "Routine" },
    ...overrides,
  };
}

function quote(
  overrides: Partial<BookingCancellationQuoteResult> = {},
): BookingCancellationQuoteResult {
  return {
    bookingRequestId: "booking-1",
    cancellable: true,
    actor: "owner",
    bookingStatus: "approved",
    reasonRequired: false,
    policyCode: "flexible",
    refundType: "full",
    refundAmount: 375,
    currency: "USD",
    failureReasons: [],
    ...overrides,
  };
}

function cardProps(
  bookingItem: BookingDashboardItem,
  overrides: Record<string, unknown> = {},
) {
  return {
    item: bookingItem,
    view: "renter" as const,
    reviewFormOpenRentingId: null,
    onToggleReviewForm: vi.fn(),
    onReviewSaved: vi.fn(),
    canManageOwnerActions: true,
    quoteByBookingId: {},
    reasonByBookingId: {},
    instructionDraftByRentingId: {},
    disputeDraftByRentingId: {},
    quotePendingId: null,
    cancelPendingId: null,
    rentingMutationPendingKey: null,
    onReviewCancellation: vi.fn().mockResolvedValue(undefined),
    onReasonChange: vi.fn(),
    onCancelBooking: vi.fn().mockResolvedValue(undefined),
    onInstructionChange: vi.fn(),
    onSaveInstructions: vi.fn().mockResolvedValue(undefined),
    onMarkCheckInReady: vi.fn().mockResolvedValue(undefined),
    onMarkCheckInComplete: vi.fn().mockResolvedValue(undefined),
    onCompleteReturn: vi.fn().mockResolvedValue(undefined),
    onDisputeChange: vi.fn(),
    onCreateDispute: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("BookingItemCard", () => {
  it("covers booking helper outcomes", () => {
    expect(humanizeActionNeeded()).toBeNull();
    expect(humanizeActionNeeded("payment_failure")).toBe("Payment Failure");
    expect(canReviewCancellation(item())).toBe(true);
    for (const sourceStatus of ["declined", "expired", "cancelled", "refunded"] as const) {
      expect(canReviewCancellation(item({ sourceStatus }))).toBe(false);
    }
    expect(canReviewCancellation(item({ kind: "renting" }))).toBe(false);
    expect(bannerClasses("error")).toContain("rose");
    expect(bannerClasses("success")).toContain("emerald");
    expect(urgencyClasses("high")).toContain("rose");
    expect(urgencyClasses("medium")).toContain("amber");
    expect(urgencyClasses("low")).toContain("sky");
    expect(urgencyClasses("none")).toContain("slate");
    expect(canOpenDispute(item())).toBe(false);
    expect(canLeaveReview(item(), "renter")).toBe(false);
    expect(canLeaveReview(item({ kind: "renting" }), "owner")).toBe(false);
  });

  it("renders booking metadata, photo, hold urgency, and pending cancellation", async () => {
    const user = userEvent.setup();
    const onReviewCancellation = vi.fn().mockResolvedValue(undefined);
    const bookingItem = item({
      durationDays: 1,
      guestCount: 1,
      actionNeededCategory: "payment_failure",
      confirmedAt: "2026-07-02T10:00:00.000Z",
      holdExpiresAt: "2026-07-03T10:00:00.000Z",
      isExpiringHold: true,
      posting: {
        id: "posting-1",
        name: "Lake House",
        primaryPhotoUrl: "https://img/house.jpg",
        effectiveMaxBookingDurationDays: 14,
      },
      urgency: { level: "high", rank: 1, isActionable: true, label: "High urgency" },
    });
    render(
      <BookingItemCard
        {...cardProps(bookingItem, {
          quotePendingId: "booking-1",
          onReviewCancellation,
        })}
      />,
    );
    expect(screen.getByAltText("Lake House")).toBeInTheDocument();
    expect(screen.getByText("1 day")).toBeInTheDocument();
    expect(screen.getByText("1 guest")).toBeInTheDocument();
    expect(screen.getByText("Payment Failure")).toBeInTheDocument();
    expect(screen.getByText(/needs attention soon/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking..." })).toBeDisabled();

    const { unmount } = render(
      <BookingItemCard {...cardProps(bookingItem, { onReviewCancellation })} />,
    );
    await user.click(screen.getAllByRole("button", { name: "Review cancellation" })[0]);
    expect(onReviewCancellation).toHaveBeenCalledWith("booking-1");
    unmount();
  });

  it.each([
    ["none", "No refund"],
    ["partial", "Partial refund"],
    ["full", "Full refund"],
    ["unsupported", "Unsupported"],
  ] as const)("renders the %s cancellation refund outcome", (refundType, label) => {
    const bookingItem = item();
    const result = quote({ refundType: refundType as never });
    render(
      <BookingItemCard
        {...cardProps(bookingItem, {
          quoteByBookingId: { "booking-1": result },
          cancelPendingId: refundType === "partial" ? "booking-1" : null,
        })}
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: refundType === "partial" ? "Cancelling..." : "Confirm cancellation",
      }),
    ).toBeInTheDocument();
  });

  it("edits a required cancellation reason and confirms", async () => {
    const user = userEvent.setup();
    const bookingItem = item();
    const onReasonChange = vi.fn();
    const onCancelBooking = vi.fn().mockResolvedValue(undefined);
    render(
      <BookingItemCard
        {...cardProps(bookingItem, {
          quoteByBookingId: { "booking-1": quote({ reasonRequired: true }) },
          reasonByBookingId: { "booking-1": "Owner reason" },
          onReasonChange,
          onCancelBooking,
        })}
      />,
    );
    const textarea = screen.getByRole("textbox", { name: "Owner cancellation reason" });
    await user.type(textarea, " updated");
    expect(onReasonChange).toHaveBeenCalledWith("booking-1", expect.any(String));
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(onCancelBooking).toHaveBeenCalledWith("booking-1");
  });

  it("renders cancellability failure messages and their fallback", () => {
    const bookingItem = item();
    const { rerender } = render(
      <BookingItemCard
        {...cardProps(bookingItem, {
          quoteByBookingId: {
            "booking-1": quote({
              cancellable: false,
              failureReasons: [
                { code: "booking_status_ineligible", message: "Too late" },
              ],
            }),
          },
        })}
      />,
    );
    expect(screen.getByText("Too late")).toBeInTheDocument();
    rerender(
      <BookingItemCard
        {...cardProps(bookingItem, {
          quoteByBookingId: {
            "booking-1": quote({ cancellable: false, failureReasons: [] }),
          },
        })}
      />,
    );
    expect(screen.getByText("This booking cannot be cancelled.")).toBeInTheDocument();
  });

  it.each(["cancelled", "refunded"] as const)(
    "renders the %s terminal booking state",
    (sourceStatus) => {
      render(
        <BookingItemCard
          {...cardProps(
            item({
              sourceStatus,
              status: sourceStatus,
              updatedAt: sourceStatus === "cancelled" ? "2026-07-05T10:00:00.000Z" : "",
            }),
          )}
        />,
      );
      expect(
        screen.getByText(sourceStatus === "refunded" ? "Refunded booking" : /Cancelled booking/),
      ).toBeInTheDocument();
    },
  );

  it("renders renter instructions before and after check-in readiness", () => {
    const waiting = item({
      kind: "renting",
      rentingId: "renting-1",
      status: "confirmed",
      sourceStatus: "confirmed",
    });
    const { rerender } = render(<BookingItemCard {...cardProps(waiting)} />);
    expect(screen.getByText(/instructions will appear here/)).toBeInTheDocument();

    rerender(
      <BookingItemCard
        {...cardProps(
          item({
            kind: "renting",
            rentingId: "renting-1",
            status: "active",
            sourceStatus: "active",
            pickupInstructions: "Front desk",
            returnInstructions: "Key box",
          }),
        )}
      />,
    );
    expect(screen.getByText("Front desk")).toBeInTheDocument();
    expect(screen.getByText("Key box")).toBeInTheDocument();
  });

  it("renders all owner renting controls, drafts, and pending labels", async () => {
    const user = userEvent.setup();
    const onInstructionChange = vi.fn();
    const onSaveInstructions = vi.fn().mockResolvedValue(undefined);
    const onMarkCheckInReady = vi.fn().mockResolvedValue(undefined);
    const onMarkCheckInComplete = vi.fn().mockResolvedValue(undefined);
    const renting = item({
      kind: "renting",
      rentingId: "renting-1",
      status: "confirmed",
      sourceStatus: "confirmed",
      confirmedAt: "2026-07-01T10:00:00.000Z",
    });
    const { rerender } = render(
      <BookingItemCard
        {...cardProps(renting, {
          view: "owner",
          instructionDraftByRentingId: {
            "renting-1": { pickupInstructions: "Pickup", returnInstructions: "Return" },
          },
          onInstructionChange,
          onSaveInstructions,
          onMarkCheckInReady,
          onMarkCheckInComplete,
        })}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/pickup or check-in works/), {
      target: { value: "New pickup" },
    });
    expect(onInstructionChange).toHaveBeenCalledWith(
      "renting-1",
      "pickupInstructions",
      "New pickup",
    );
    await user.click(screen.getByRole("button", { name: "Save instructions" }));
    await user.click(screen.getByRole("button", { name: "Mark check-in ready" }));
    await user.click(screen.getByRole("button", { name: "Confirm check-in" }));
    expect(onSaveInstructions).toHaveBeenCalledWith("renting-1");
    expect(onMarkCheckInReady).toHaveBeenCalledWith("renting-1");
    expect(onMarkCheckInComplete).toHaveBeenCalledWith("renting-1");

    rerender(
      <BookingItemCard
        {...cardProps(renting, {
          view: "owner",
          rentingMutationPendingKey: "save-instructions:renting-1",
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("renders timeline timestamps, existing dispute, review, and dispute editing", async () => {
    const user = userEvent.setup();
    const onToggleReviewForm = vi.fn();
    const onDisputeChange = vi.fn();
    const onCreateDispute = vi.fn().mockResolvedValue(undefined);
    const completed = item({
      kind: "renting",
      rentingId: "renting-1",
      status: "completed",
      sourceStatus: "completed",
      confirmedAt: "2026-07-01T10:00:00.000Z",
      checkInReadyAt: "2026-07-02T10:00:00.000Z",
      checkInCompletedAt: "2026-07-03T10:00:00.000Z",
      returnDueAt: "2026-07-04T10:00:00.000Z",
      completedAt: "2026-07-05T10:00:00.000Z",
    });
    const { rerender } = render(
      <BookingItemCard
        {...cardProps(completed, {
          reviewFormOpenRentingId: "renting-1",
          onToggleReviewForm,
        })}
      />,
    );
    expect(screen.getByText("Review form for posting-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide review form" }));
    expect(onToggleReviewForm).toHaveBeenCalledWith("renting-1");

    const active = item({
      kind: "renting",
      rentingId: "renting-2",
      status: "active",
      sourceStatus: "active",
    });
    rerender(
      <BookingItemCard
        {...cardProps(active, {
          disputeDraftByRentingId: {
            "renting-2": { reason: "Damage", details: "Details" },
          },
          onDisputeChange,
          onCreateDispute,
        })}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Summarize the issue."), {
      target: { value: "Changed" },
    });
    expect(onDisputeChange).toHaveBeenCalledWith("renting-2", "reason", "Changed");
    await user.click(screen.getByRole("button", { name: "Open dispute" }));
    expect(onCreateDispute).toHaveBeenCalledWith("renting-2");

    rerender(
      <BookingItemCard
        {...cardProps(
          item({
            kind: "renting",
            rentingId: "renting-3",
            status: "disputed",
            sourceStatus: "disputed",
            disputedAt: "2026-07-06T10:00:00.000Z",
            dispute: {
              id: "dispute-1",
              rentingId: "renting-3",
              openedByUserId: "renter-1",
              reason: "Damage",
              details: "Existing details",
              createdAt: "2026-07-06T10:00:00.000Z",
              updatedAt: "2026-07-06T10:00:00.000Z",
            },
          }),
        )}
      />,
    );
    expect(screen.getByText("Existing details")).toBeInTheDocument();
    expect(screen.getAllByText(/Disputed:/).length).toBeGreaterThan(0);
  });
});
