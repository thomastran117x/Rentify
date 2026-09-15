import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import type { PaymentRecord } from "@/lib/payments/api";
import { PaymentReturnClient } from "./payment-return-client";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const { useAuthMock, captureMock, retryMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  captureMock: vi.fn(),
  retryMock: vi.fn(),
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
    retry: retryMock,
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

function apiError(status: number, code: string) {
  return new ApiClientError("Request failed", {
    status,
    code,
    request: {
      method: "POST",
      path: "/payments/payment-1/capture",
      requestUrl: "/payments/payment-1/capture",
    },
  });
}

function renderReturn(cancelled = false) {
  return render(
    <PaymentReturnClient paymentId="payment-1" cancelled={cancelled} />,
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

  it("shows the cancelled state without capturing", () => {
    renderReturn(true);

    expect(screen.getByText("Payment cancelled")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to bookings" }),
    ).toHaveAttribute("href", "/bookings");
    expect(captureMock).not.toHaveBeenCalled();
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
    expect(captureMock).toHaveBeenCalledWith("payment-1");
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

  it("shows the decline reason and restarts checkout on retry", async () => {
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
    let resolveRetry: (payment: PaymentRecord) => void = () => undefined;
    retryMock.mockReturnValue(
      new Promise<PaymentRecord>((resolve) => {
        resolveRetry = resolve;
      }),
    );

    renderReturn();

    expect(
      await screen.findByText("The instrument presented was declined."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Try again with PayPal" }),
    );

    expect(
      screen.getByRole("button", { name: "Restarting checkout..." }),
    ).toBeDisabled();
    expect(retryMock).toHaveBeenCalledWith("payment-1");

    resolveRetry(buildPayment({ status: "failed_retryable" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Try again with PayPal" }),
      ).toBeEnabled(),
    );
  });

  it("falls back to a generic decline message and surfaces retry errors", async () => {
    captureMock.mockResolvedValue(buildPayment({ status: "cancelled" }));
    retryMock.mockRejectedValue(new Error("network down"));

    renderReturn();

    expect(
      await screen.findByText(/PayPal couldn't complete this payment/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Try again with PayPal" }),
    );

    expect(
      await screen.findByText("We couldn't confirm your payment"),
    ).toBeInTheDocument();
  });

  it("explains when a paid booking needs reconciliation", async () => {
    captureMock.mockRejectedValue(apiError(409, "CONFLICT"));

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
