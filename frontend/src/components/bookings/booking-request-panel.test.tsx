import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BookingRequestPanel,
  describeFailure,
  getFieldClassName,
  toIsoDate,
  validate,
} from "./booking-request-panel";
import { ApiClientError } from "@/lib/api/types";
import type { PublicPostingDetail } from "@/lib/postings/public";

const { createMock, quoteMock, useAuthMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  quoteMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/booking-requests/api", () => ({
  bookingRequestsApi: {
    create: createMock,
    quote: quoteMock,
  },
}));

function buildPosting(
  overrides: Partial<PublicPostingDetail> = {},
): PublicPostingDetail {
  return {
    id: "posting-1",
    organizationId: "org-1",
    status: "published",
    variant: { family: "space", subtype: "loft" },
    name: "Sunny loft workspace",
    description: "A bright loft.",
    pricing: { currency: "CAD", daily: { amount: 150 } },
    pricingCurrency: "CAD",
    photos: [],
    tags: [],
    details: {},
    availabilityStatus: "available",
    effectiveMaxBookingDurationDays: 30,
    availabilityBlocks: [],
    location: {
      city: "Toronto",
      region: "ON",
      country: "Canada",
      latitude: 43.65,
      longitude: -79.38,
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildBookingRecord(status: string, autoApproved?: boolean) {
  return {
    id: "booking-1",
    postingId: "posting-1",
    renterId: "user-1",
    organizationId: "org-1",
    status,
    startAt: "2026-08-01T00:00:00.000Z",
    endAt: "2026-08-05T00:00:00.000Z",
    durationDays: 4,
    guestCount: 1,
    contactName: "Renter One",
    contactEmail: "user1@rentify.local",
    pricingCurrency: "CAD",
    dailyPriceAmount: 150,
    estimatedTotal: 600,
    holdExpiresAt: "2026-05-28T12:00:00.000Z",
    createdAt: "2026-05-25T11:00:00.000Z",
    updatedAt: "2026-05-25T11:00:00.000Z",
    posting: {
      id: "posting-1",
      name: "Sunny loft workspace",
      effectiveMaxBookingDurationDays: 30,
    },
    ...(autoApproved ? { autoApproved } : {}),
  };
}

async function fillValidDates() {
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-08-01" },
  });
  fireEvent.change(screen.getByLabelText("End date"), {
    target: { value: "2026-08-05" },
  });
  // Wait for the debounced quote and the enabled submit button.
  await waitFor(() => expect(quoteMock).toHaveBeenCalled());
}

describe("BookingRequestPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: { username: "Renter One", email: "user1@rentify.local" },
      },
    });
    quoteMock.mockResolvedValue({
      postingId: "posting-1",
      bookable: true,
      durationDays: 4,
      pricingCurrency: "CAD",
      dailyPriceAmount: 150,
      estimatedTotal: 600,
      maxBookingDurationDays: 30,
      minBookingDurationDays: null,
      advanceNoticeDays: null,
      instantBooking: false,
      cancellationPolicy: null,
      cancellationPolicyNotes: null,
      failureReasons: [],
    });
  });

  it("prompts anonymous visitors to sign in instead of showing the form", () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });

    render(<BookingRequestPanel posting={buildPosting()} />);

    expect(
      screen.getByRole("link", { name: "Sign in to book" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
  });

  it("shows validation errors when submitting without dates", () => {
    render(<BookingRequestPanel posting={buildPosting()} />);

    fireEvent.click(screen.getByRole("button", { name: "Request to book" }));

    expect(screen.getByText("Choose a start date.")).toBeInTheDocument();
    expect(screen.getByText("Choose an end date.")).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("surfaces quote failure reasons and blocks submission", async () => {
    quoteMock.mockResolvedValue({
      postingId: "posting-1",
      bookable: false,
      durationDays: 4,
      pricingCurrency: "CAD",
      dailyPriceAmount: 150,
      estimatedTotal: null,
      maxBookingDurationDays: 30,
      minBookingDurationDays: null,
      advanceNoticeDays: null,
      instantBooking: false,
      cancellationPolicy: null,
      cancellationPolicyNotes: null,
      failureReasons: [{ code: "renting_overlap", message: "overlap" }],
    });

    render(<BookingRequestPanel posting={buildPosting()} />);
    await fillValidDates();

    expect(
      await screen.findByText("Those dates overlap an existing booking."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request to book" }),
    ).toBeDisabled();
  });

  it("shows instantly-approved confirmation for an instant-book posting", async () => {
    quoteMock.mockResolvedValue({
      postingId: "posting-1",
      bookable: true,
      durationDays: 4,
      pricingCurrency: "CAD",
      dailyPriceAmount: 150,
      estimatedTotal: 600,
      maxBookingDurationDays: 30,
      minBookingDurationDays: null,
      advanceNoticeDays: null,
      instantBooking: true,
      cancellationPolicy: null,
      cancellationPolicyNotes: null,
      failureReasons: [],
    });
    createMock.mockResolvedValue(buildBookingRecord("awaiting_payment", true));

    render(
      <BookingRequestPanel posting={buildPosting({ instantBooking: true })} />,
    );
    await fillValidDates();

    const submit = await screen.findByRole("button", {
      name: "Book instantly",
    });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(
      await screen.findByText("Your booking was instantly approved"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Complete payment" }),
    ).toBeInTheDocument();
  });

  it("shows pending confirmation for a standard posting", async () => {
    createMock.mockResolvedValue(buildBookingRecord("pending"));

    render(<BookingRequestPanel posting={buildPosting()} />);
    await fillValidDates();

    const submit = await screen.findByRole("button", {
      name: "Request to book",
    });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(
      await screen.findByText("Your request is pending approval"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View my bookings" }),
    ).toBeInTheDocument();
  });

  it("renders an API error when submission fails", async () => {
    createMock.mockRejectedValue(
      new ApiClientError("Booking failed.", {
        code: "CONFLICT",
        request: {
          method: "POST",
          path: "/postings/posting-1/booking-requests",
          requestUrl:
            "http://localhost:8040/api/v1/postings/posting-1/booking-requests",
        },
        status: 409,
      }),
    );

    render(<BookingRequestPanel posting={buildPosting()} />);
    await fillValidDates();

    const submit = await screen.findByRole("button", {
      name: "Request to book",
    });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(
      await screen.findByText("Couldn't submit your booking request"),
    ).toBeInTheDocument();
  });

  it("validates every local field and accepts a complete form", () => {
    expect(
      validate({
        startAt: "2026-08-05",
        endAt: "2026-08-01",
        guestCount: "0.5",
        note: "",
        contactName: " ",
        contactEmail: "invalid",
        contactPhoneNumber: "",
      }),
    ).toEqual({
      endAt: "The end date must be after the start date.",
      guestCount: "Enter at least one guest.",
      contactName: "Enter a contact name.",
      contactEmail: "Use a valid email address.",
    });
    expect(
      validate({
        startAt: "2026-08-01",
        endAt: "2026-08-05",
        guestCount: "2",
        note: "hello",
        contactName: "Renter",
        contactEmail: "renter@example.com",
        contactPhoneNumber: "555",
      }),
    ).toEqual({});
    expect(toIsoDate("2026-08-01")).toBe("2026-08-01T00:00:00.000Z");
    expect(getFieldClassName(true)).toContain("border-rose-300");
    expect(getFieldClassName(false)).toContain("border-slate-200");
  });

  it("describes known, server-provided, and fallback quote failures", () => {
    expect(describeFailure({ code: "own_posting", message: "ignored" })).toMatch(/own organization/i);
    expect(describeFailure({ code: "renting_overlap", message: "ignored" })).toMatch(/existing booking/i);
    expect(describeFailure({ code: "future_reason", message: "Server reason" } as never)).toBe("Server reason");
    expect(describeFailure({ code: "future_reason", message: null } as never)).toBe("These dates can't be booked.");
  });

  it("shows quote errors and sends optional quote fields", async () => {
    quoteMock.mockRejectedValueOnce(new Error("offline"));
    render(<BookingRequestPanel posting={buildPosting()} />);
    fireEvent.change(screen.getByLabelText("Guests"), { target: { value: "bad" } });
    fireEvent.change(screen.getByPlaceholderText(/Share anything/i), { target: { value: "  owner note  " } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-08-05" } });

    expect(await screen.findByText(/couldn't check availability/i)).toBeInTheDocument();
    expect(quoteMock).toHaveBeenCalledWith(
      "posting-1",
      expect.objectContaining({ guestCount: undefined, note: "owner note" }),
    );
  });

  it("renders singular and unavailable quote details", async () => {
    quoteMock.mockResolvedValue({
      postingId: "posting-1",
      bookable: true,
      durationDays: 1,
      pricingCurrency: "CAD",
      dailyPriceAmount: 150,
      estimatedTotal: null,
      maxBookingDurationDays: 30,
      minBookingDurationDays: null,
      advanceNoticeDays: null,
      instantBooking: true,
      cancellationPolicy: null,
      cancellationPolicyNotes: null,
      failureReasons: [],
    });
    render(<BookingRequestPanel posting={buildPosting({ instantBooking: true })} />);
    await fillValidDates();
    expect(await screen.findByText("1 day")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByText(/Instant Book/).length).toBeGreaterThan(1);
  });

  it("maps server field errors onto the form", async () => {
    createMock.mockRejectedValue(
      new ApiClientError("Validation failed.", {
        code: "VALIDATION_ERROR",
        details: {
          startAt: ["Start is unavailable."],
          contactEmail: ["Email is blocked."],
          note: 42,
        },
        request: { method: "POST", path: "/bookings", requestUrl: "http://localhost/bookings" },
        status: 400,
      }),
    );
    render(<BookingRequestPanel posting={buildPosting()} />);
    await fillValidDates();
    fireEvent.click(screen.getByRole("button", { name: "Request to book" }));
    expect(await screen.findByText("Start is unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Email is blocked.")).toBeInTheDocument();
  });

  it("clears confirmation to book different dates", async () => {
    createMock.mockResolvedValue(buildBookingRecord("pending"));
    render(<BookingRequestPanel posting={buildPosting()} />);
    await fillValidDates();
    fireEvent.click(screen.getByRole("button", { name: "Request to book" }));
    await screen.findByText("Your request is pending approval");
    fireEvent.click(screen.getByRole("button", { name: "Book different dates" }));
    expect(screen.getByLabelText("Start date")).toHaveValue("");
    expect(screen.getByLabelText("End date")).toHaveValue("");
  });
});
