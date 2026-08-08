import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import type { PaymentRecord } from "@/lib/payments/api";
import type { RentingRecord } from "@/lib/rentings/api";
import { RentingDetailClient } from "./renting-detail-client";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  getByIdMock,
  updateInstructionsMock,
  markCheckInReadyMock,
  markCheckInCompleteMock,
  markReturnCompleteMock,
  createDisputeMock,
  getPaymentMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateInstructionsMock: vi.fn(),
  markCheckInReadyMock: vi.fn(),
  markCheckInCompleteMock: vi.fn(),
  markReturnCompleteMock: vi.fn(),
  createDisputeMock: vi.fn(),
  getPaymentMock: vi.fn(),
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

vi.mock("@/lib/rentings/api", () => ({
  rentingsApi: {
    getById: getByIdMock,
    updateInstructions: updateInstructionsMock,
    markCheckInReady: markCheckInReadyMock,
    markCheckInComplete: markCheckInCompleteMock,
    markReturnComplete: markReturnCompleteMock,
    createDispute: createDisputeMock,
  },
}));

vi.mock("@/lib/payments/api", () => ({
  paymentsApi: {
    getByBookingRequest: getPaymentMock,
  },
}));

function buildSession(
  role: "user" | "owner" | "admin",
  userId = "renter-1",
  activeOrganization?: {
    id: string;
    name: string;
    role: "primary_manager" | "manager" | "operator";
  },
) {
  return {
    accessToken: "access-token",
    device: { known: true, knownByIp: false },
    user: {
      id: userId,
      email: "person@example.com",
      username: "person",
      role,
      activeOrganization,
    },
  };
}

function buildRenting(overrides: Partial<RentingRecord> = {}): RentingRecord {
  return {
    id: "renting-1",
    postingId: "posting-1",
    bookingRequestId: "booking-1",
    renterId: "renter-1",
    organizationId: "org-1",
    status: "active",
    startAt: "2026-08-01T15:00:00.000Z",
    endAt: "2026-08-04T11:00:00.000Z",
    durationDays: 3,
    guestCount: 2,
    pricingCurrency: "USD",
    dailyPriceAmount: 125,
    estimatedTotal: 375,
    confirmedAt: "2026-07-20T10:00:00.000Z",
    pickupInstructions: "Meet at the front desk.",
    returnInstructions: "Leave the keys in the lockbox.",
    checkInCompletedAt: "2026-08-01T16:00:00.000Z",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    posting: {
      id: "posting-1",
      name: "Lake House Retreat",
    },
    ...overrides,
  };
}

function buildPayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "payment-1",
    bookingRequestId: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    organizationId: "org-1",
    provider: "square",
    status: "succeeded",
    pricingCurrency: "USD",
    rentalSubtotalAmount: 375,
    platformFeeAmount: 37.5,
    totalAmount: 412.5,
    succeededAt: "2026-07-20T11:00:00.000Z",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T11:00:00.000Z",
    booking: {
      id: "booking-1",
      status: "paid",
      startAt: "2026-08-01T15:00:00.000Z",
      endAt: "2026-08-04T11:00:00.000Z",
      holdExpiresAt: "2026-07-21T10:00:00.000Z",
      paymentReconciliationRequired: false,
    },
    attempts: [],
    refunds: [],
    ...overrides,
  };
}

describe("RentingDetailClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("user"),
    });
    getByIdMock.mockResolvedValue(buildRenting());
    getPaymentMock.mockResolvedValue(buildPayment());
    updateInstructionsMock.mockResolvedValue(buildRenting());
    markCheckInReadyMock.mockResolvedValue(buildRenting());
    markCheckInCompleteMock.mockResolvedValue(buildRenting());
    markReturnCompleteMock.mockResolvedValue(buildRenting());
    createDisputeMock.mockResolvedValue(buildRenting());
  });

  it("redirects anonymous users to the login page", async () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });

    render(<RentingDetailClient rentingId="renting-1" />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/login");
    });
  });

  it("shows the auth loading state without loading a renting", () => {
    useAuthMock.mockReturnValue({ status: "loading", session: null });

    render(<RentingDetailClient rentingId="renting-1" />);

    expect(screen.getByText("Loading renting details...")).toBeInTheDocument();
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it("renders dedicated not-found and load-error states", async () => {
    getByIdMock.mockRejectedValueOnce(
      new ApiClientError("Missing", {
        status: 404,
        code: "RESOURCE_NOT_FOUND",
        request: { method: "GET", path: "/rentings/1", requestUrl: "/rentings/1" },
      }),
    );
    const { unmount } = render(<RentingDetailClient rentingId="missing" />);
    expect(
      await screen.findByText("We couldn't find this renting."),
    ).toBeInTheDocument();
    unmount();

    getByIdMock.mockRejectedValueOnce(new Error("offline"));
    render(<RentingDetailClient rentingId="broken" />);
    expect(
      await screen.findByText("We couldn't load this renting right now."),
    ).toBeInTheDocument();
  });

  it("renders the record with a read-only instructions view and receipt for the renter", async () => {
    render(<RentingDetailClient rentingId="renting-1" />);

    expect(await screen.findByText("Lake House Retreat")).toBeInTheDocument();
    expect(screen.getByText("Meet at the front desk.")).toBeInTheDocument();
    expect(getPaymentMock).toHaveBeenCalledWith("booking-1");
    expect(screen.getByText("Platform fee")).toBeInTheDocument();
    expect(screen.getByText(/412\.50/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save instructions" }),
    ).not.toBeInTheDocument();
  });

  it("lets a managing org member edit and save instructions", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("user", "manager-9", {
        id: "org-1",
        name: "Org One",
        role: "manager",
      }),
    });

    render(<RentingDetailClient rentingId="renting-1" />);

    const saveButton = await screen.findByRole("button", {
      name: "Save instructions",
    });
    const pickup = screen.getByLabelText("Pickup instructions");
    fireEvent.change(pickup, { target: { value: "Updated pickup" } });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateInstructionsMock).toHaveBeenCalledWith("renting-1", {
        pickupInstructions: "Updated pickup",
        returnInstructions: "Leave the keys in the lockbox.",
      });
    });
    expect(await screen.findByText("Instructions saved.")).toBeInTheDocument();
  });

  it("shows mutation errors while retaining owner controls", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("admin", "admin-1"),
    });
    updateInstructionsMock.mockRejectedValue(new Error("offline"));

    render(<RentingDetailClient rentingId="renting-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Save instructions" }),
    );

    expect(
      await screen.findByText("We couldn't complete that action. Please try again."),
    ).toBeInTheDocument();
  });

  it("shows fallback copy when renter instructions are blank", async () => {
    getByIdMock.mockResolvedValue(
      buildRenting({ pickupInstructions: " ", returnInstructions: undefined }),
    );

    render(<RentingDetailClient rentingId="renting-1" />);

    expect(
      await screen.findByText(
        "The owner has not shared pickup instructions yet.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The owner has not shared return instructions yet."),
    ).toBeInTheDocument();
  });

  it.each([
    ["confirmed", "Mark check-in ready", markCheckInReadyMock, "Marked check-in ready."],
    ["check_in_ready", "Confirm check-in", markCheckInCompleteMock, "Check-in confirmed."],
    ["return_due", "Confirm return", markReturnCompleteMock, "Return confirmed."],
  ] as const)(
    "runs the %s lifecycle action",
    async (rentingStatus, buttonName, actionMock, successMessage) => {
      useAuthMock.mockReturnValue({
        status: "authenticated",
        session: buildSession("user", "manager-9", {
          id: "org-1",
          name: "Org One",
          role: "manager",
        }),
      });
      getByIdMock.mockResolvedValue(buildRenting({ status: rentingStatus }));

      render(<RentingDetailClient rentingId="renting-1" />);
      fireEvent.click(await screen.findByRole("button", { name: buttonName }));

      await waitFor(() => expect(actionMock).toHaveBeenCalledWith("renting-1"));
      expect(await screen.findByText(successMessage)).toBeInTheDocument();
    },
  );

  it("disables check-in readiness until both instructions exist", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("user", "manager-9", {
        id: "org-1",
        name: "Org One",
        role: "manager",
      }),
    });
    getByIdMock.mockResolvedValue(
      buildRenting({ status: "confirmed", pickupInstructions: "" }),
    );

    render(<RentingDetailClient rentingId="renting-1" />);

    expect(
      await screen.findByRole("button", { name: "Mark check-in ready" }),
    ).toBeDisabled();
  });

  it("opens a dispute with optional details", async () => {
    render(<RentingDetailClient rentingId="renting-1" />);

    const button = await screen.findByRole("button", { name: "Open dispute" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Reason"), {
      target: { value: "Item was damaged" },
    });
    fireEvent.change(screen.getByPlaceholderText("Add any details (optional)"), {
      target: { value: "Photos attached" },
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(createDisputeMock).toHaveBeenCalledWith("renting-1", {
        reason: "Item was damaged",
        details: "Photos attached",
      }),
    );
    expect(await screen.findByText("Dispute opened.")).toBeInTheDocument();
  });

  it("renders an existing dispute, cancellation, photo, and singular labels", async () => {
    getByIdMock.mockResolvedValue(
      buildRenting({
        durationDays: 1,
        guestCount: 1,
        cancelledAt: "2026-08-02T12:00:00.000Z",
        disputedAt: "2026-08-02T11:00:00.000Z",
        posting: {
          id: "posting-1",
          name: "Lake House Retreat",
          primaryPhotoUrl: "https://example.com/photo.jpg",
        },
        dispute: {
          id: "dispute-1",
          rentingId: "renting-1",
          openedByUserId: "renter-1",
          reason: "Damaged",
          details: "A detailed report",
          createdAt: "2026-08-02T11:00:00.000Z",
          updatedAt: "2026-08-02T11:00:00.000Z",
        },
      }),
    );

    render(<RentingDetailClient rentingId="renting-1" />);

    expect(await screen.findByAltText("Lake House Retreat")).toBeInTheDocument();
    expect(screen.getByText("1 day")).toBeInTheDocument();
    expect(screen.getByText("1 guest")).toBeInTheDocument();
    expect(screen.getByText("A detailed report")).toBeInTheDocument();
    expect(screen.getByText(/Cancelled/)).toBeInTheDocument();
  });

  it("hides owner controls from a global owner role without managing membership", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("owner", "owner-9"),
    });

    render(<RentingDetailClient rentingId="renting-1" />);

    expect(await screen.findByText("Lake House Retreat")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save instructions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm check-in" }),
    ).not.toBeInTheDocument();
  });

  it("shows the review link for a completed, undisputed renting", async () => {
    getByIdMock.mockResolvedValue(
      buildRenting({
        status: "completed",
        completedAt: "2026-08-04T12:00:00.000Z",
      }),
    );

    render(<RentingDetailClient rentingId="renting-1" />);

    const reviewLink = await screen.findByRole("link", {
      name: "View reviews",
    });
    expect(reviewLink).toHaveAttribute("href", "/postings/posting-1");
  });

  it("treats a 404 receipt as a soft empty state", async () => {
    getPaymentMock.mockRejectedValue(
      new ApiClientError("Payment could not be found.", {
        status: 404,
        code: "RESOURCE_NOT_FOUND",
        request: {
          method: "GET",
          path: "/booking-requests/booking-1/payment",
          requestUrl: "http://test/booking-requests/booking-1/payment",
        },
      }),
    );

    render(<RentingDetailClient rentingId="renting-1" />);

    expect(
      await screen.findByText(
        "A receipt is not available for this renting yet.",
      ),
    ).toBeInTheDocument();
  });

  it("surfaces an error state when the receipt fails to load", async () => {
    getPaymentMock.mockRejectedValue(
      new ApiClientError("Forbidden.", {
        status: 403,
        code: "FORBIDDEN",
        request: {
          method: "GET",
          path: "/booking-requests/booking-1/payment",
          requestUrl: "http://test/booking-requests/booking-1/payment",
        },
      }),
    );

    render(<RentingDetailClient rentingId="renting-1" />);

    expect(await screen.findByText("Lake House Retreat")).toBeInTheDocument();
    expect(
      screen.queryByText("A receipt is not available for this renting yet."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/couldn't load the payment receipt/i),
    ).toBeInTheDocument();
  });
});
