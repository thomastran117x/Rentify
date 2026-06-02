import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BookingCancellationQuoteResult,
  BookingRequestRecord,
  BookingRequestsListResult,
} from "@/lib/bookings/types";
import { AccountBookingsPanel } from "./account-bookings-panel";

const { listMineMock, listOwnedMock, getCancellationQuoteMock, cancelMock } =
  vi.hoisted(() => ({
    listMineMock: vi.fn(),
    listOwnedMock: vi.fn(),
    getCancellationQuoteMock: vi.fn(),
    cancelMock: vi.fn(),
  }));

vi.mock("@/lib/bookings/api", () => ({
  bookingsApi: {
    listMine: listMineMock,
    listOwned: listOwnedMock,
    getCancellationQuote: getCancellationQuoteMock,
    cancel: cancelMock,
  },
}));

function buildBooking(
  overrides: Partial<BookingRequestRecord> = {},
): BookingRequestRecord {
  return {
    id: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    organizationId: "org-1",
    status: "approved",
    startAt: "2026-07-01T15:00:00.000Z",
    endAt: "2026-07-03T11:00:00.000Z",
    durationDays: 2,
    guestCount: 2,
    contactName: "Pat Example",
    contactEmail: "pat@example.com",
    pricingCurrency: "USD",
    dailyPriceAmount: 120,
    estimatedTotal: 240,
    holdExpiresAt: "2026-06-30T18:00:00.000Z",
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
    posting: {
      id: "posting-1",
      name: "Lake House Retreat",
      effectiveMaxBookingDurationDays: 14,
    },
    ...overrides,
  };
}

function buildListResult(
  bookingRequests: BookingRequestRecord[],
): BookingRequestsListResult {
  return {
    bookingRequests,
    pagination: {
      page: 1,
      pageSize: 10,
      total: bookingRequests.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
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
    refundAmount: 120,
    currency: "USD",
    failureReasons: [],
    ...overrides,
  };
}

describe("AccountBookingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMineMock.mockResolvedValue(buildListResult([]));
    listOwnedMock.mockResolvedValue(buildListResult([]));
    getCancellationQuoteMock.mockResolvedValue(buildCancellationQuote());
    cancelMock.mockResolvedValue({
      id: "booking-1",
      status: "cancelled",
    });
  });

  it("loads renter bookings for regular users without fetching owner data", async () => {
    listMineMock.mockResolvedValue(
      buildListResult([
        buildBooking({
          posting: {
            id: "posting-1",
            name: "Lake House Retreat",
            effectiveMaxBookingDurationDays: 14,
          },
        }),
      ]),
    );

    render(<AccountBookingsPanel role="user" />);

    expect(
      screen.getByText("Loading booking management..."),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Renter bookings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Lake House Retreat")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Owner bookings" }),
    ).not.toBeInTheDocument();
    expect(listMineMock).toHaveBeenCalledTimes(1);
    expect(listOwnedMock).not.toHaveBeenCalled();
  });

  it("loads both renter and owner bookings for owners", async () => {
    listMineMock.mockResolvedValue(
      buildListResult([
        buildBooking({
          id: "booking-renter",
          posting: {
            id: "posting-renter",
            name: "Guest Loft",
            effectiveMaxBookingDurationDays: 10,
          },
        }),
      ]),
    );
    listOwnedMock.mockResolvedValue(
      buildListResult([
        buildBooking({
          id: "booking-owner",
          postingId: "posting-owner",
          posting: {
            id: "posting-owner",
            name: "Owner Cabin",
            effectiveMaxBookingDurationDays: 10,
          },
        }),
      ]),
    );

    render(<AccountBookingsPanel role="owner" />);

    expect(
      await screen.findByRole("heading", { name: "Owner bookings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Guest Loft")).toBeInTheDocument();
    expect(screen.getByText("Owner Cabin")).toBeInTheDocument();
    expect(listMineMock).toHaveBeenCalledTimes(1);
    expect(listOwnedMock).toHaveBeenCalledTimes(1);
  });

  it("shows owner bookings for operators without owner cancellation controls", async () => {
    listOwnedMock.mockResolvedValue(
      buildListResult([
        buildBooking({
          id: "booking-owner",
          postingId: "posting-owner",
          posting: {
            id: "posting-owner",
            name: "Owner Cabin",
            effectiveMaxBookingDurationDays: 10,
          },
        }),
      ]),
    );

    render(
      <AccountBookingsPanel
        role="user"
        activeOrganization={{
          id: "org-1",
          name: "Org One",
          role: "operator",
        }}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Owner bookings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Owner Cabin")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review cancellation" }),
    ).not.toBeInTheDocument();
  });

  it("reviews cancellation terms and submits a trimmed cancellation reason", async () => {
    const user = userEvent.setup();
    listMineMock.mockResolvedValue(
      buildListResult([
        buildBooking({
          id: "booking-cancel",
          posting: {
            id: "posting-1",
            name: "Beach House",
            effectiveMaxBookingDurationDays: 7,
          },
        }),
      ]),
    );
    getCancellationQuoteMock.mockResolvedValue(
      buildCancellationQuote({
        bookingRequestId: "booking-cancel",
      }),
    );

    render(<AccountBookingsPanel role="user" />);

    await screen.findByText("Beach House");
    await user.click(
      screen.getByRole("button", { name: "Review cancellation" }),
    );

    expect(await screen.findByText("Cancellation review")).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Owner cancellation reason" }),
      "  Schedule changed  ",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm cancellation" }),
    );

    await waitFor(() => {
      expect(cancelMock).toHaveBeenCalledWith("booking-cancel", {
        reason: "Schedule changed",
      });
    });
    await waitFor(() => {
      expect(listMineMock).toHaveBeenCalledTimes(2);
    });
  });

  it("shows a fallback message when bookings cannot be loaded", async () => {
    listMineMock.mockRejectedValue(new Error("network failed"));

    render(<AccountBookingsPanel role="user" />);

    expect(
      await screen.findByText("Bookings could not be loaded right now."),
    ).toBeInTheDocument();
  });
});
