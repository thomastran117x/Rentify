import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientMock } = vi.hoisted(() => ({ clientMock: vi.fn() }));

vi.mock("@/components/bookings/booking-detail-client", () => ({
  BookingDetailClient: (props: Record<string, unknown>) => {
    clientMock(props);
    return <div data-testid="booking-detail-client" />;
  },
}));

const { default: BookingDetailPage, metadata } = await import("./page");

describe("BookingDetailPage", () => {
  beforeEach(() => {
    clientMock.mockReset();
  });

  it("awaits the params promise and passes the id through", async () => {
    const element = await BookingDetailPage({
      params: Promise.resolve({ id: "booking-42" }),
    });

    render(element);

    expect(screen.getByTestId("booking-detail-client")).toBeInTheDocument();
    expect(clientMock).toHaveBeenCalledWith({
      bookingRequestId: "booking-42",
    });
  });

  it("exposes page metadata", () => {
    expect(metadata.title).toBe("Booking Detail | Rentify");
  });
});
