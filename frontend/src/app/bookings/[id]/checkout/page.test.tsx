import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientMock } = vi.hoisted(() => ({ clientMock: vi.fn() }));

vi.mock("@/components/checkout/booking-checkout-client", () => ({
  BookingCheckoutClient: (props: Record<string, unknown>) => {
    clientMock(props);
    return <div data-testid="booking-checkout-client" />;
  },
}));

const { default: BookingCheckoutPage, metadata } = await import("./page");

describe("BookingCheckoutPage", () => {
  beforeEach(() => {
    clientMock.mockReset();
  });

  it("awaits the params promise and passes the booking id through", async () => {
    const element = await BookingCheckoutPage({
      params: Promise.resolve({ id: "booking-42" }),
    });

    render(element);

    expect(screen.getByTestId("booking-checkout-client")).toBeInTheDocument();
    expect(clientMock).toHaveBeenCalledWith({
      bookingRequestId: "booking-42",
    });
  });

  it("exposes page metadata", () => {
    expect(metadata.title).toBe("Checkout | Rentify");
  });
});
