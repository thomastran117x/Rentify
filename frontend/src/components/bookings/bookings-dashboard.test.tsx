import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BookingCancellationQuoteResult,
  BookingDashboardItem,
  OwnerBookingDashboardResult,
  RenterBookingDashboardResult,
} from "@/lib/bookings/types";
import { BookingsDashboard } from "./bookings-dashboard";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  getMyDashboardMock,
  getOwnerDashboardMock,
  getCancellationQuoteMock,
  cancelMock,
  getOwnReviewMock,
  updateInstructionsMock,
  markReadyMock,
  markCompleteMock,
  completeReturnMock,
  createDisputeMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getMyDashboardMock: vi.fn(),
  getOwnerDashboardMock: vi.fn(),
  getCancellationQuoteMock: vi.fn(),
  cancelMock: vi.fn(),
  getOwnReviewMock: vi.fn(),
  updateInstructionsMock: vi.fn(),
  markReadyMock: vi.fn(),
  markCompleteMock: vi.fn(),
  completeReturnMock: vi.fn(),
  createDisputeMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
}));

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

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/bookings/api", () => ({
  bookingsApi: {
    getMyDashboard: getMyDashboardMock,
    getOwnerDashboard: getOwnerDashboardMock,
    getCancellationQuote: getCancellationQuoteMock,
    cancel: cancelMock,
    updateRentingInstructions: updateInstructionsMock,
    markRentingCheckInReady: markReadyMock,
    markRentingCheckInComplete: markCompleteMock,
    completeRentingReturn: completeReturnMock,
    createRentingDispute: createDisputeMock,
  },
}));

vi.mock("@/lib/postings/api", () => ({
  postingsApi: {
    getOwnReview: getOwnReviewMock,
    createReview: vi.fn(),
    updateOwnReview: vi.fn(),
  },
}));

function buildSession(
  role: "user" | "owner" | "admin",
  activeOrganization?: {
    id: string;
    name: string;
    role: "primary_manager" | "manager" | "operator";
  },
) {
  return {
    accessToken: "access-token",
    device: {
      known: true,
      knownByIp: false,
    },
    user: {
      id: "user-1",
      email: "person@example.com",
      username: "person",
      role,
      activeOrganization,
    },
  };
}

function buildDashboardItem(
  overrides: Partial<BookingDashboardItem> = {},
): BookingDashboardItem {
  return {
    id: "dashboard-item-1",
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
      name: "Lake House Retreat",
      effectiveMaxBookingDurationDays: 14,
    },
    isExpiringHold: false,
    nextAction: {
      code: "monitor_upcoming",
      label: "Monitor upcoming stay",
    },
    urgency: {
      level: "low",
      rank: 3,
      isActionable: false,
      label: "Low urgency",
    },
    ...overrides,
  };
}

function buildRenterDashboard(
  overrides: Partial<RenterBookingDashboardResult> = {},
): RenterBookingDashboardResult {
  return {
    summary: {
      upcoming: 0,
      active: 0,
      pending: 0,
      actionNeeded: 0,
      past: 0,
      cancelled: 0,
    },
    items: [],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    filters: {
      page: 1,
      pageSize: 20,
      sort: "urgency",
    },
    ...overrides,
  };
}

function buildOwnerDashboard(
  overrides: Partial<OwnerBookingDashboardResult> = {},
): OwnerBookingDashboardResult {
  return {
    summary: {
      approval: 0,
      payment: 0,
      expiringHold: 0,
      paymentFailure: 0,
      conversion: 0,
      upcomingRentings: 0,
      activeRentings: 0,
      pastRentings: 0,
      totalOpen: 0,
    },
    items: [],
    postings: [],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    filters: {
      page: 1,
      pageSize: 20,
      sort: "urgency",
    },
    ...overrides,
  };
}

function buildCancellationQuote(
  overrides: Partial<BookingCancellationQuoteResult> = {},
): BookingCancellationQuoteResult {
  return {
    bookingRequestId: "booking-1",
    cancellable: true,
    actor: "owner",
    bookingStatus: "approved",
    reasonRequired: true,
    policyCode: "flexible",
    refundType: "partial",
    refundAmount: 150,
    currency: "USD",
    failureReasons: [],
    ...overrides,
  };
}

describe("BookingsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("user"),
    });
    getMyDashboardMock.mockResolvedValue(buildRenterDashboard());
    getOwnerDashboardMock.mockResolvedValue(buildOwnerDashboard());
    getCancellationQuoteMock.mockResolvedValue(buildCancellationQuote());
    getOwnReviewMock.mockResolvedValue({ eligible: true, review: null });
    cancelMock.mockResolvedValue({
      id: "booking-1",
      status: "cancelled",
    });
    updateInstructionsMock.mockResolvedValue(undefined);
    markReadyMock.mockResolvedValue(undefined);
    markCompleteMock.mockResolvedValue(undefined);
    completeReturnMock.mockResolvedValue(undefined);
    createDisputeMock.mockResolvedValue(undefined);
  });

  it("redirects anonymous users to the login page", async () => {
    useAuthMock.mockReturnValue({
      status: "anonymous",
      session: null,
    });

    render(<BookingsDashboard />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/login");
    });
    expect(
      screen.getByText("Loading bookings workspace..."),
    ).toBeInTheDocument();
  });

  it("shows a loading state while auth status is still resolving", () => {
    useAuthMock.mockReturnValue({
      status: "loading",
      session: null,
    });

    render(<BookingsDashboard />);

    expect(
      screen.getByText("Loading bookings workspace..."),
    ).toBeInTheDocument();
  });

  it("loads the renter dashboard and shows the empty state when there are no items", async () => {
    render(<BookingsDashboard />);

    expect(
      await screen.findByText("No bookings match these filters"),
    ).toBeInTheDocument();
    expect(getMyDashboardMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sort: "urgency",
    });
  });

  it("defaults owners into the owner view and lets them switch back to renter data", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("owner"),
    });
    getOwnerDashboardMock.mockResolvedValue(
      buildOwnerDashboard({
        items: [
          buildDashboardItem({
            id: "owner-item",
            bookingRequestId: "owner-booking",
          }),
        ],
      }),
    );
    getMyDashboardMock.mockResolvedValue(
      buildRenterDashboard({
        items: [
          buildDashboardItem({
            id: "renter-item",
            bookingRequestId: "renter-booking",
          }),
        ],
      }),
    );

    render(<BookingsDashboard />);

    await waitFor(() => {
      expect(getOwnerDashboardMock).toHaveBeenCalled();
    });
    expect(
      await screen.findByRole("button", { name: "Renter" }),
    ).toBeInTheDocument();
    const renterCallsBeforeSwitch = getMyDashboardMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Renter" }));

    await waitFor(() => {
      expect(getMyDashboardMock.mock.calls.length).toBeGreaterThan(
        renterCallsBeforeSwitch,
      );
    });
  });

  it("reviews cancellation details and completes a cancellation from the dashboard", async () => {
    getMyDashboardMock.mockResolvedValue(
      buildRenterDashboard({
        items: [
          buildDashboardItem({
            id: "cancel-item",
            bookingRequestId: "booking-cancel",
            posting: {
              id: "posting-1",
              name: "Harbor Cottage",
              effectiveMaxBookingDurationDays: 10,
            },
          }),
        ],
      }),
    );
    getCancellationQuoteMock.mockResolvedValue(
      buildCancellationQuote({
        bookingRequestId: "booking-cancel",
      }),
    );

    render(<BookingsDashboard />);

    expect(
      await screen.findByRole("button", { name: "Review cancellation" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Review cancellation" }),
    );

    expect(await screen.findByText("Cancellation review")).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Owner cancellation reason" }),
      {
        target: { value: "  Guest asked to reschedule  " },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm cancellation" }),
    );

    await waitFor(() => {
      expect(cancelMock).toHaveBeenCalledWith("booking-cancel", {
        reason: "Guest asked to reschedule",
      });
    });
    expect(
      await screen.findByText("Booking cancellation completed."),
    ).toBeInTheDocument();
  });

  it("links renting items to their detail page", async () => {
    getMyDashboardMock.mockResolvedValue(
      buildRenterDashboard({
        items: [
          buildDashboardItem({
            id: "renting-item",
            kind: "renting",
            rentingId: "renting-1",
            bookingRequestId: "booking-1",
            status: "active",
            sourceStatus: "active",
          }),
        ],
      }),
    );

    render(<BookingsDashboard />);

    const detailsLink = await screen.findByRole("link", {
      name: "View details",
    });
    expect(detailsLink).toHaveAttribute("href", "/rentings/renting-1");
  });

  it("keeps operators in the owner view but hides owner mutation controls", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("user", {
        id: "org-1",
        name: "Org One",
        role: "operator",
      }),
    });
    getOwnerDashboardMock.mockResolvedValue(
      buildOwnerDashboard({
        items: [
          buildDashboardItem({
            id: "owner-item",
            bookingRequestId: "owner-booking",
          }),
        ],
      }),
    );

    render(<BookingsDashboard />);

    await waitFor(() => {
      expect(getOwnerDashboardMock).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: "Renter" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review cancellation" }),
    ).not.toBeInTheDocument();
  });

  it("offers a review form on completed rentings in the renter view", async () => {
    const user = userEvent.setup();
    getMyDashboardMock.mockResolvedValue(
      buildRenterDashboard({
        items: [
          buildDashboardItem({
            id: "renting-item",
            kind: "renting",
            rentingId: "renting-1",
            status: "completed",
            sourceStatus: "completed",
            completedAt: "2026-07-01T10:00:00.000Z",
          }),
        ],
      }),
    );

    render(<BookingsDashboard />);

    await user.click(
      await screen.findByRole("button", { name: "Leave a review" }),
    );

    await waitFor(() => {
      expect(getOwnReviewMock).toHaveBeenCalledWith("posting-1");
    });
    expect(
      await screen.findByRole("button", { name: "Submit review" }),
    ).toBeInTheDocument();
  });

  it("hides the review action once a dispute exists", async () => {
    getMyDashboardMock.mockResolvedValue(
      buildRenterDashboard({
        items: [
          buildDashboardItem({
            id: "renting-item",
            kind: "renting",
            rentingId: "renting-1",
            status: "disputed",
            sourceStatus: "completed",
            completedAt: "2026-07-01T10:00:00.000Z",
            dispute: {
              id: "dispute-1",
              rentingId: "renting-1",
              openedByUserId: "renter-1",
              reason: "Damage",
              createdAt: "2026-07-02T10:00:00.000Z",
              updatedAt: "2026-07-02T10:00:00.000Z",
            },
          }),
        ],
      }),
    );

    render(<BookingsDashboard />);

    await waitFor(() => {
      expect(getMyDashboardMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("button", { name: "Leave a review" }),
    ).not.toBeInTheDocument();
  });

  it("never offers the review action in the owner view", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("owner"),
    });
    getOwnerDashboardMock.mockResolvedValue(
      buildOwnerDashboard({
        items: [
          buildDashboardItem({
            id: "owner-renting",
            kind: "renting",
            rentingId: "renting-1",
            status: "completed",
            sourceStatus: "completed",
            completedAt: "2026-07-01T10:00:00.000Z",
          }),
        ],
      }),
    );

    render(<BookingsDashboard />);

    await waitFor(() => {
      expect(getOwnerDashboardMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("button", { name: "Leave a review" }),
    ).not.toBeInTheDocument();
  });

  it("pages the renter dashboard while the renter view is active", async () => {
    getMyDashboardMock.mockResolvedValue(
      buildRenterDashboard({
        items: [buildDashboardItem({ id: "renter-item" })],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 45,
          totalPages: 3,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      }),
    );

    render(<BookingsDashboard />);

    await screen.findByRole("button", { name: "Next page" });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(getMyDashboardMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });
    expect(getOwnerDashboardMock).not.toHaveBeenCalled();
  });

  it("pages the owner dashboard while the owner view is active", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("owner"),
    });
    getOwnerDashboardMock.mockResolvedValue(
      buildOwnerDashboard({
        items: [buildDashboardItem({ id: "owner-item" })],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 45,
          totalPages: 3,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      }),
    );

    render(<BookingsDashboard />);

    await screen.findByRole("button", { name: "Next page" });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(getOwnerDashboardMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });
  });

  it("resets the owner page and records the size when it changes", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("owner"),
    });
    getOwnerDashboardMock.mockResolvedValue(
      buildOwnerDashboard({
        items: [buildDashboardItem({ id: "owner-item" })],
        pagination: {
          page: 3,
          pageSize: 20,
          total: 45,
          totalPages: 3,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      }),
    );

    render(<BookingsDashboard />);

    const sizeSelect = await screen.findByRole("combobox", {
      name: "Per page",
    });
    fireEvent.change(sizeSelect, { target: { value: "50" } });

    await waitFor(() => {
      expect(getOwnerDashboardMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, pageSize: 50 }),
      );
    });
  });

  it("saves owner instructions and advances confirmed check-in actions", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue({ status: "authenticated", session: buildSession("owner") });
    getOwnerDashboardMock.mockResolvedValue(buildOwnerDashboard({
      items: [buildDashboardItem({ id: "renting-item", kind: "renting", rentingId: "renting-1", status: "confirmed", sourceStatus: "confirmed" })],
    }));
    render(<BookingsDashboard />);
    const pickup = await screen.findByPlaceholderText("Share where and how pickup or check-in works.");
    const returns = screen.getByPlaceholderText("Share where and how return or check-out works.");
    await user.type(pickup, "  Front desk  ");
    await user.type(returns, "  Key box  ");
    await user.click(screen.getByRole("button", { name: "Save instructions" }));
    await waitFor(() => expect(updateInstructionsMock).toHaveBeenCalledWith("renting-1", { pickupInstructions: "Front desk", returnInstructions: "Key box" }));
    await user.click(screen.getByRole("button", { name: "Mark check-in ready" }));
    await waitFor(() => expect(markReadyMock).toHaveBeenCalledWith("renting-1"));
    await user.click(screen.getByRole("button", { name: "Confirm check-in" }));
    await waitFor(() => expect(markCompleteMock).toHaveBeenCalledWith("renting-1"));
  });

  it("confirms the return of an active renting", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue({ status: "authenticated", session: buildSession("owner") });
    getOwnerDashboardMock.mockResolvedValue(buildOwnerDashboard({
      items: [buildDashboardItem({ id: "active-renting", kind: "renting", rentingId: "renting-2", status: "active", sourceStatus: "active" })],
    }));
    render(<BookingsDashboard />);
    await user.click(await screen.findByRole("button", { name: "Confirm return" }));
    await waitFor(() => expect(completeReturnMock).toHaveBeenCalledWith("renting-2"));
    expect(await screen.findByText("Renting return confirmed.")).toBeInTheDocument();
  });
});
