import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, type AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import type { PaymentRecord } from "@/lib/payments/api";
import { PaymentReturnClient } from "./payment-return-client";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const { useAuthMock, captureMock, cancelCheckoutMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  captureMock: vi.fn(),
  cancelCheckoutMock: vi.fn(),
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

vi.mock("@/lib/payments/api", () => ({
  paymentsApi: {
    capture: captureMock,
    cancelCheckout: cancelCheckoutMock,
  },
}));

function buildPayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "payment-1",
    bookingRequestId: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    organizationId: "org-1",
    provider: "paypal",
    status: "succeeded",
    pricingCurrency: "USD",
    rentalSubtotalAmount: 375,
    platformFeeAmount: 37.5,
    totalAmount: 412.5,
    providerOrderId: "ORDER-1",
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

function apiError(status: number, code: string, details?: unknown) {
  return new ApiClientError("Request failed", {
    status,
    code,
    details,
    request: {
      method: "POST",
      path: "/payments/payment-1/capture",
      requestUrl: "/payments/payment-1/capture",
    },
  });
}

function renderReturn(cancelled = false, orderId?: string) {
  return render(
    <PaymentReturnClient
      paymentId="payment-1"
      cancelled={cancelled}
      orderId={orderId}
    />,
  );
}

describe("PaymentReturnClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    useAuthMock.mockReturnValue({ status: "authenticated", session: {} });
  });

  it("redirects anonymous visitors to login without capturing", () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });

    const { container } = renderReturn();

    expect(routerReplaceMock).toHaveBeenCalledWith("/login");
    expect(captureMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("waits for the session before capturing", () => {
    useAuthMock.mockReturnValue({ status: "loading", session: null });

    renderReturn();

    expect(screen.getByText("Confirming your payment")).toBeInTheDocument();
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("records a cancelled checkout and lets the renter restart it", async () => {
    cancelCheckoutMock.mockResolvedValue(
      buildPayment({ status: "failed_final" }),
    );

    renderReturn(true);

    expect(screen.getByText("Checking your checkout")).toBeInTheDocument();
    expect(await screen.findByText("Payment cancelled")).toBeInTheDocument();
    expect(cancelCheckoutMock).toHaveBeenCalledWith("payment-1", {
      orderId: undefined,
    });
    expect(captureMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Back to bookings" }),
    ).toHaveAttribute("href", "/bookings");
    expect(
      screen.getByRole("link", { name: "Restart checkout" }),
    ).toHaveAttribute("href", "/bookings/booking-1/checkout");
  });

  it("confirms the payment when a cancelled checkout was actually paid", async () => {
    cancelCheckoutMock.mockResolvedValue(buildPayment());

    renderReturn(true);

    expect(await screen.findByText("Payment confirmed")).toBeInTheDocument();
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("offers to retry when recording a cancelled checkout fails", async () => {
    cancelCheckoutMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(buildPayment({ status: "failed_final" }));

    renderReturn(true);

    expect(
      await screen.findByText("We couldn't update your checkout"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Payment cancelled")).toBeInTheDocument();
  });

  it("captures once and shows the confirmed payment", async () => {
    captureMock.mockResolvedValue(buildPayment());

    render(
      <StrictMode>
        <PaymentReturnClient paymentId="payment-1" cancelled={false} />
      </StrictMode>,
    );

    expect(await screen.findByText("Payment confirmed")).toBeInTheDocument();
    expect(screen.getByText(/\$412\.50/)).toBeInTheDocument();
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith("payment-1", {
      orderId: undefined,
    });
  });

  it("captures the order PayPal returned with", async () => {
    captureMock.mockResolvedValue(buildPayment());

    renderReturn(false, "ORDER-9");

    expect(await screen.findByText("Payment confirmed")).toBeInTheDocument();
    expect(captureMock).toHaveBeenCalledWith("payment-1", {
      orderId: "ORDER-9",
    });
  });

  it("cancels only the order PayPal sent the renter back from", async () => {
    cancelCheckoutMock.mockResolvedValue(
      buildPayment({ status: "failed_final" }),
    );

    renderReturn(true, "ORDER-9");

    expect(await screen.findByText("Payment cancelled")).toBeInTheDocument();
    expect(cancelCheckoutMock).toHaveBeenCalledWith("payment-1", {
      orderId: "ORDER-9",
    });
  });

  it("explains that a replaced checkout was not cancelled either", async () => {
    cancelCheckoutMock.mockRejectedValue(
      apiError(409, "CONFLICT", { reason: "stale_order" }),
    );

    renderReturn(true, "ORDER-OLD");

    expect(
      await screen.findByText("This checkout was replaced"),
    ).toBeInTheDocument();
  });

  it("explains that a replaced checkout was not charged", async () => {
    captureMock.mockRejectedValue(
      apiError(409, "CONFLICT", { reason: "stale_order" }),
    );

    renderReturn(false, "ORDER-OLD");

    expect(
      await screen.findByText("This checkout was replaced"),
    ).toBeInTheDocument();
  });

  it("lets the renter check a pending payment again", async () => {
    captureMock
      .mockResolvedValueOnce(buildPayment({ status: "processing" }))
      .mockResolvedValueOnce(buildPayment());

    renderReturn();

    expect(
      await screen.findByText("Payment still processing"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(await screen.findByText("Payment confirmed")).toBeInTheDocument();
    expect(captureMock).toHaveBeenCalledTimes(2);
  });

  it("shows the decline reason and links back to checkout", async () => {
    captureMock.mockResolvedValue(
      buildPayment({
        status: "failed_final",
        attempts: [
          {
            id: "attempt-1",
            paymentId: "payment-1",
            idempotencyKey: "idem-1",
            status: "failed_final",
            retryCount: 0,
            failureMessage: "The instrument presented was declined.",
            createdAt: "2026-07-20T10:00:00.000Z",
            updatedAt: "2026-07-20T10:00:00.000Z",
          },
        ],
      }),
    );

    renderReturn();

    expect(
      await screen.findByText("The instrument presented was declined."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/bookings/booking-1/checkout",
    );
  });

  it("falls back to a generic decline message", async () => {
    captureMock.mockResolvedValue(buildPayment({ status: "cancelled" }));

    renderReturn();

    expect(
      await screen.findByText(/The payment didn't go through/),
    ).toBeInTheDocument();
  });

  it("explains when a paid booking needs reconciliation", async () => {
    captureMock.mockRejectedValue(
      apiError(409, "CONFLICT", { reason: "reconciliation_required" }),
    );

    renderReturn();

    expect(
      await screen.findByText("Payment received, booking under review"),
    ).toBeInTheDocument();
  });

  it("shows capture errors and retries the capture", async () => {
    captureMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(buildPayment());

    renderReturn();

    expect(
      await screen.findByText("We couldn't confirm your payment"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Payment confirmed")).toBeInTheDocument();
  });
});
