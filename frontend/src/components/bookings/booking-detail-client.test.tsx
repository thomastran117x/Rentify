import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  routerPushMock,
  routerReplaceMock,
  resetRouterMocks,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  getBookingByIdMock,
  panelMock,
  approveMock,
  declineMock,
  convertMock,
  createPaymentSessionMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getBookingByIdMock: vi.fn(),
  panelMock: vi.fn(),
  approveMock: vi.fn(),
  declineMock: vi.fn(),
  convertMock: vi.fn(),
  createPaymentSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock }),
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
  bookingsApi: {
    getBookingById: getBookingByIdMock,
    approve: approveMock,
    decline: declineMock,
    convertToRenting: convertMock,
    createPaymentSession: createPaymentSessionMock,
  },
}));

vi.mock("@/components/bookings/booking-messages-panel", () => ({
  BookingMessagesPanel: (props: Record<string, unknown>) => {
    panelMock(props);
    return <div data-testid="messages-panel" />;
  },
}));

const { ApiClientError, ApiError } = await import("@/lib/api/types");
const { BookingDetailClient } = await import(
  "@/components/bookings/booking-detail-client"
);

function buildSession(
  overrides: {
    id?: string;
    activeOrganization?: { id: string; role: string };
  } = {},
) {
  return {
    user: {
      id: overrides.id ?? "renter-1",
      email: "user1@rentify.local",
      username: "renter-one",
      role: "user" as const,
      ...(overrides.activeOrganization
        ? { activeOrganization: overrides.activeOrganization }
        : {}),
    },
  };
}

function buildBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    renterId: "renter-1",
    organizationId: "org-1",
    status: "pending",
    startAt: "2027-03-10T16:00:00.000Z",
    endAt: "2027-03-12T16:00:00.000Z",
    estimatedTotal: 450,
    pricingCurrency: "CAD",
    note: "Quiet work trip.",
    holdExpiresAt: "2099-01-01T00:00:00.000Z",
    posting: { id: "posting-1", name: "Sunny loft workspace" },
    viewerAccess: { side: "renter", canManage: true },
    ...overrides,
  };
}

const OWNER_MANAGER_ACCESS = { side: "owner", canManage: true };

const managerSession = () =>
  buildSession({
    id: "manager-1",
    activeOrganization: { id: "org-1", role: "manager" },
  });

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
    approveMock.mockReset();
    declineMock.mockReset();
    convertMock.mockReset();
    createPaymentSessionMock.mockReset();

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

    expect(await screen.findByText("Sunny loft workspace")).toBeInTheDocument();
    expect(screen.getByText("Quiet work trip.")).toBeInTheDocument();
    expect(screen.getByTestId("messages-panel")).toBeInTheDocument();

    // The panel resolves the viewer's side and write capability from the API,
    // so the route only needs to hand it the booking id.
    expect(panelMock).toHaveBeenCalledWith({
      bookingRequestId: "booking-1",
      currentUserId: "renter-1",
    });
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

  it("lets an organization manager approve a pending request", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: managerSession(),
    });
    getBookingByIdMock.mockResolvedValue(
      buildBooking({ viewerAccess: OWNER_MANAGER_ACCESS }),
    );
    // Decision responses carry no viewerAccess; the page must keep what it
    // loaded rather than drop the viewer's rights.
    approveMock.mockResolvedValue(
      buildBooking({ status: "awaiting_payment", viewerAccess: undefined }),
    );

    renderClient();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledWith("booking-1");
    });
    expect(
      await screen.findByText(
        "Booking request approved. The renter has been asked to pay.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
  });

  it("declines with a note and shows it back to the viewer", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: managerSession(),
    });
    getBookingByIdMock.mockResolvedValue(
      buildBooking({ viewerAccess: OWNER_MANAGER_ACCESS }),
    );
    declineMock.mockResolvedValue(
      buildBooking({ status: "declined", decisionNote: "Dates conflict" }),
    );

    renderClient();

    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Decline note (optional)" }),
      { target: { value: "Dates conflict" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm decline" }));

    await waitFor(() => {
      expect(declineMock).toHaveBeenCalledWith("booking-1", {
        note: "Dates conflict",
      });
    });
    expect(await screen.findByText("Dates conflict")).toBeInTheDocument();
  });

  it("does not offer owner actions to the renter", async () => {
    renderClient();

    expect(await screen.findByText("Sunny loft workspace")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
  });

  it("does not offer owner actions to read-only members of the booking's organization", async () => {
    // A site owner whose active organization matches but who is only an
    // operator there: the API reports no manage rights, so nothing is offered.
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession({
        id: "operator-1",
        activeOrganization: { id: "org-1", role: "operator" },
      }),
    });
    getBookingByIdMock.mockResolvedValue(
      buildBooking({ viewerAccess: { side: "owner", canManage: false } }),
    );

    renderClient();

    expect(await screen.findByText("Sunny loft workspace")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
  });

  it("offers owner actions to a manager of the booking's organization while another organization is active", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: buildSession({
        id: "manager-2",
        activeOrganization: { id: "org-2", role: "manager" },
      }),
    });
    getBookingByIdMock.mockResolvedValue(
      buildBooking({ viewerAccess: OWNER_MANAGER_ACCESS }),
    );

    renderClient();

    expect(
      await screen.findByRole("button", { name: "Approve" }),
    ).toBeInTheDocument();
  });

  it("converts a paid booking and opens the new renting", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: managerSession(),
    });
    getBookingByIdMock.mockResolvedValue(
      buildBooking({ status: "paid", viewerAccess: OWNER_MANAGER_ACCESS }),
    );
    convertMock.mockResolvedValue({ id: "renting-9" });

    renderClient();

    fireEvent.click(
      await screen.findByRole("button", { name: "Convert to renting" }),
    );

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/rentings/renting-9");
    });
  });

  it("sends the renter to the checkout page to pay", async () => {
    getBookingByIdMock.mockResolvedValue(
      buildBooking({ status: "awaiting_payment" }),
    );

    renderClient();

    expect(
      await screen.findByRole("link", { name: "Pay now" }),
    ).toHaveAttribute("href", "/bookings/booking-1/checkout");
    expect(createPaymentSessionMock).not.toHaveBeenCalled();
  });

  it("lets the renter continue an unfinished checkout", async () => {
    getBookingByIdMock.mockResolvedValue(
      buildBooking({ status: "payment_processing" }),
    );

    renderClient();

    expect(
      await screen.findByRole("link", { name: "Continue checkout" }),
    ).toHaveAttribute("href", "/bookings/booking-1/checkout");
  });

  it("shows the API's reason when a decision is rejected", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: managerSession(),
    });
    getBookingByIdMock.mockResolvedValue(
      buildBooking({ viewerAccess: OWNER_MANAGER_ACCESS }),
    );
    approveMock.mockRejectedValue(
      new ApiClientError("Only pending booking requests can be approved.", {
        status: 400,
        code: "BAD_REQUEST",
        request: {
          method: "POST",
          path: "/booking-requests/booking-1/approve",
          requestUrl:
            "https://api.test/api/v1/booking-requests/booking-1/approve",
        },
      }),
    );

    renderClient();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only pending booking requests can be approved.",
    );
  });
});
