import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  getPaymentMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateInstructionsMock: vi.fn(),
  markCheckInReadyMock: vi.fn(),
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
  });

  it("redirects anonymous users to the login page", async () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });

    render(<RentingDetailClient rentingId="renting-1" />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/login");
    });
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

  it("lets an owner edit and save instructions", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession("owner", "owner-9"),
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

  it("shows the review link for a completed, undisputed renting", async () => {
    getByIdMock.mockResolvedValue(
      buildRenting({
        status: "completed",
        completedAt: "2026-08-04T12:00:00.000Z",
      }),
    );

    render(<RentingDetailClient rentingId="renting-1" />);

    const reviewLink = await screen.findByRole("link", {
      name: "Leave / view a review",
    });
    expect(reviewLink).toHaveAttribute("href", "/postings/posting-1");
  });

  it("treats a missing receipt as a soft empty state", async () => {
    getPaymentMock.mockRejectedValue(new Error("no payment"));

    render(<RentingDetailClient rentingId="renting-1" />);

    expect(
      await screen.findByText("A receipt is not available for this renting yet."),
    ).toBeInTheDocument();
  });
});
