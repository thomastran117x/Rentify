import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCheckoutSummary } from "@/test/mocks/checkout";
import {
  CheckoutBookingHeader,
  CheckoutCancellationPolicy,
  CheckoutHoldCountdown,
  CheckoutPriceBreakdown,
  formatHoldRemaining,
} from "./checkout-summary";

describe("CheckoutBookingHeader", () => {
  it("shows the posting, dates, duration, and guests", () => {
    render(<CheckoutBookingHeader summary={buildCheckoutSummary()} />);

    expect(
      screen.getByRole("heading", { name: "Junction Team Offsite Loft" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://example.com/loft.jpg",
    );
    expect(screen.getByText(/4 days/)).toBeInTheDocument();
    expect(screen.getByText("2 guests")).toBeInTheDocument();
  });

  it("uses singular units and a placeholder without a photo", () => {
    const summary = buildCheckoutSummary();
    summary.booking.durationDays = 1;
    summary.booking.guestCount = 1;
    summary.posting.primaryPhotoUrl = undefined;

    render(<CheckoutBookingHeader summary={summary} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/1 day$/)).toBeInTheDocument();
    expect(screen.getByText("1 guest")).toBeInTheDocument();
  });
});

describe("CheckoutPriceBreakdown", () => {
  it("itemizes the stay total, deposit, fee, charge, and balance", () => {
    render(<CheckoutPriceBreakdown summary={buildCheckoutSummary()} />);

    const row = (label: string) =>
      screen.getByText(label).closest("div") as HTMLElement;

    expect(row("Stay total (4 days)")).toHaveTextContent("1,000.00");
    expect(row("Deposit due today (25%)")).toHaveTextContent("250.00");
    expect(row("Platform fee (10% of deposit)")).toHaveTextContent("25.00");
    expect(row("Charged today")).toHaveTextContent("275.00");
    expect(row("Remaining balance")).toHaveTextContent("750.00");
    expect(
      screen.getByText(/remaining balance is not charged by Rentify/),
    ).toBeInTheDocument();
  });

  it("drops percentages when stored amounts predate the current pricing", () => {
    const summary = buildCheckoutSummary();
    summary.pricing.depositBps = null;
    summary.pricing.platformFeeBps = null;

    render(<CheckoutPriceBreakdown summary={summary} />);

    expect(screen.getByText("Deposit due today")).toBeInTheDocument();
    expect(screen.getByText("Platform fee")).toBeInTheDocument();
  });
});

describe("CheckoutCancellationPolicy", () => {
  it("describes the enforced refund rules and the host's notes", () => {
    render(<CheckoutCancellationPolicy summary={buildCheckoutSummary()} />);

    expect(
      screen.getByText(/more than 48 hours before your stay/),
    ).toBeInTheDocument();
    expect(screen.getByText(/24 to 48 hours/)).toHaveTextContent("50% refund");
    expect(
      screen.getByText("If the host cancels, you get a full refund."),
    ).toBeInTheDocument();
    expect(screen.getByText("Early check-in on request.")).toBeInTheDocument();
  });

  it("omits host notes and the host refund line when they do not apply", () => {
    const summary = buildCheckoutSummary();
    summary.cancellationPolicy.hostNotes = undefined;
    summary.cancellationPolicy.ownerCancellationFullRefund = false;

    render(<CheckoutCancellationPolicy summary={summary} />);

    expect(screen.queryByText("Notes from the host")).not.toBeInTheDocument();
    expect(screen.queryByText(/If the host cancels/)).not.toBeInTheDocument();
  });
});

describe("formatHoldRemaining", () => {
  it("shows hours and minutes for long holds and a clock for short ones", () => {
    expect(formatHoldRemaining(3 * 60 * 60 * 1000 + 5 * 60 * 1000)).toBe(
      "3h 05m",
    );
    expect(formatHoldRemaining(4 * 60 * 1000 + 9 * 1000)).toBe("4:09");
    expect(formatHoldRemaining(-5)).toBe("0:00");
  });
});

describe("CheckoutHoldCountdown", () => {
  const NOW = Date.parse("2026-09-17T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks down, warns near expiry, and reports expiry once", () => {
    const onExpire = vi.fn();

    render(
      <CheckoutHoldCountdown
        holdExpiresAt="2026-09-17T12:00:03.000Z"
        serverOffsetMs={0}
        onExpire={onExpire}
      />,
    );

    const timer = screen.getByRole("timer");
    expect(timer).toHaveTextContent("Hold expires in 0:03");
    expect(timer).toHaveTextContent("Finish soon.");
    expect(timer.className).toContain("rose");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(timer).toHaveTextContent("Hold expires in 0:02");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(timer).toHaveTextContent("Your booking hold has expired");
    expect(onExpire).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("applies the server clock offset and calmer styling for long holds", () => {
    const onExpire = vi.fn();

    const { rerender } = render(
      <CheckoutHoldCountdown
        holdExpiresAt="2026-09-17T14:00:00.000Z"
        serverOffsetMs={30 * 60 * 1000}
        onExpire={onExpire}
      />,
    );

    expect(screen.getByRole("timer")).toHaveTextContent(
      "Hold expires in 1h 30m",
    );
    expect(screen.getByRole("timer").className).toContain("slate");

    rerender(
      <CheckoutHoldCountdown
        holdExpiresAt="2026-09-17T12:45:00.000Z"
        serverOffsetMs={0}
        onExpire={onExpire}
      />,
    );

    expect(screen.getByRole("timer").className).toContain("amber");
    expect(onExpire).not.toHaveBeenCalled();
  });
});
