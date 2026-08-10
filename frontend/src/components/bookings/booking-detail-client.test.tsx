import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routerReplaceMock, resetRouterMocks } from "@/test/mocks/next-navigation";

const { useAuthMock, getBookingByIdMock, panelMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getBookingByIdMock: vi.fn(),
  panelMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/auth/auth-context", () => ({ useAuth: useAuthMock }));

vi.mock("@/lib/bookings/api", () => ({
  bookingsApi: { getBookingById: getBookingByIdMock },
}));

vi.mock("@/components/bookings/booking-messages-panel", () => ({
  BookingMessagesPanel: (props: Record<string, unknown>) => {
    panelMock(props);
    return <div data-testid="messages-panel" />;
  },
}));

const { ApiError } = await import("@/lib/api/types");
const { BookingDetailClient } = await import(
  "@/components/bookings/booking-detail-client"
);

function buildSession() {
  return {
    user: {
      id: "renter-1",
      email: "user1@rentify.local",
      username: "renter-one",
      role: "user" as const,
    },
  };
}

function buildBooking() {
  return {
    id: "booking-1",
    renterId: "renter-1",
    status: "pending",
    startAt: "2027-03-10T16:00:00.000Z",
    endAt: "2027-03-12T16:00:00.000Z",
    estimatedTotal: 450,
    pricingCurrency: "CAD",
    note: "Quiet work trip.",
    posting: { id: "posting-1", name: "Sunny loft workspace" },
  };
}

function renderClient() {
  return render(<BookingDetailClient bookingRequestId="booking-1" />);
}

function apiError(status: number) {
  return new ApiError("failed", {
    status,
    code: "ERROR",
    request: {
      method: "GET",
      path: "/booking-requests/booking-1",
      requestUrl: "https://api.test/api/v1/booking-requests/booking-1",
    },
  });
}

describe("BookingDetailClient", () => {
  beforeEach(() => {
    resetRouterMocks();
    useAuthMock.mockReset();
    getBookingByIdMock.mockReset();
    panelMock.mockReset();

    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession(),
    });
    getBookingByIdMock.mockResolvedValue(buildBooking());
  });

  it("redirects an anonymous visitor to the login page", () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });

    renderClient();

    expect(routerReplaceMock).toHaveBeenCalledWith("/login");
  });

  it("renders a loading state before the booking arrives", () => {
    useAuthMock.mockReturnValue({ status: "loading", session: null });

    renderClient();

    expect(screen.getByText(/loading booking/i)).toBeInTheDocument();
  });

  it("renders the booking summary and wires the messages panel", async () => {
    renderClient();

    expect(
      await screen.findByText("Sunny loft workspace"),
    ).toBeInTheDocument();
    expect(screen.getByText("Quiet work trip.")).toBeInTheDocument();
    expect(screen.getByTestId("messages-panel")).toBeInTheDocument();

    expect(panelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingRequestId: "booking-1",
        currentUserId: "renter-1",
      }),
    );
  });

  it("renders a not-found state on 404", async () => {
    getBookingByIdMock.mockRejectedValue(apiError(404));

    renderClient();

    expect(await screen.findByText(/booking not found/i)).toBeInTheDocument();
  });

  it("renders a forbidden state on 403", async () => {
    getBookingByIdMock.mockRejectedValue(apiError(403));

    renderClient();

    expect(
      await screen.findByText(/you do not have access/i),
    ).toBeInTheDocument();
  });

  it("renders a generic error for other failures", async () => {
    getBookingByIdMock.mockRejectedValue(new Error("boom"));

    renderClient();

    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    );
  });
});
