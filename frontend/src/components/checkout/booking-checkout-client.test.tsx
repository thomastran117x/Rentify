import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, ApiServerError } from "@/lib/api/types";
import type { CheckoutPaymentHandlers } from "@/components/checkout/paypal-payment-methods";
import {
  buildCheckoutPayment,
  buildCheckoutSummary,
  buildPaymentAttempt,
} from "@/test/mocks/checkout";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";
import { BookingCheckoutClient } from "./booking-checkout-client";

const {
  useAuthMock,
  getCheckoutSummaryMock,
  createSessionMock,
  captureMock,
  getByIdMock,
  methodsPropsMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getCheckoutSummaryMock: vi.fn(),
  createSessionMock: vi.fn(),
  captureMock: vi.fn(),
  getByIdMock: vi.fn(),
  methodsPropsMock: vi.fn(),
}));

// The real Next router is referentially stable across renders.
const stableRouter = { replace: routerReplaceMock };

vi.mock("next/navigation", () => ({
  useRouter: () => stableRouter,
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

vi.mock("@/lib/env", () => ({
  publicEnv: { paypalClientId: "sandbox-client" },
}));

vi.mock("@/lib/payments/api", () => ({
  paymentsApi: {
    getCheckoutSummary: getCheckoutSummaryMock,
    createSession: createSessionMock,
    capture: captureMock,
    getById: getByIdMock,
  },
}));

// Stands in for the PayPal SDK: exposes the handlers as plain buttons so the
// tests can drive every checkout path.
vi.mock("@/components/checkout/paypal-payment-methods", () => ({
  PayPalPaymentMethods: (props: {
    handlers: CheckoutPaymentHandlers;
    disabled: boolean;
    onUnavailable: () => void;
  }) => {
    methodsPropsMock(props);
    const start = async () => {
      try {
        const { orderId } = await props.handlers.createOrder("card");
        await props.handlers.approve(orderId);
      } catch {
        // createOrder reports its own failures.
      }
    };
    const startOnly = async () => {
      try {
        await props.handlers.createOrder("paypal");
      } catch {
        // createOrder reports its own failures.
      }
    };

    return (
      <div data-testid="sdk-methods">
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => void start()}
        >
          SDK pay
        </button>
        <button type="button" onClick={() => void startOnly()}>
          SDK open
        </button>
        <button type="button" onClick={() => props.handlers.cancel()}>
          SDK cancel
        </button>
        <button
          type="button"
          onClick={() => props.handlers.fail(new Error("Popup blocked"))}
        >
          SDK error
        </button>
        <button type="button" onClick={() => props.handlers.fail("unexpected")}>
          SDK unknown error
        </button>
        <button type="button" onClick={() => props.onUnavailable()}>
          SDK unavailable
        </button>
      </div>
    );
  },
}));

function apiError(status: number, details?: unknown) {
  return new ApiClientError("Request failed", {
    status,
    code: status === 409 ? "CONFLICT" : "ERROR",
    details,
    request: { method: "POST", path: "/x", requestUrl: "/x" },
  });
}

function processingPayment(overrides = {}) {
  return buildCheckoutPayment({
    status: "processing",
    providerOrderId: "ORDER-2",
    checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-2",
    ...overrides,
  });
}

function renderCheckout() {
  return render(<BookingCheckoutClient bookingRequestId="booking-1" />);
}

describe("BookingCheckoutClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    useAuthMock.mockReturnValue({ status: "authenticated", session: {} });
    getCheckoutSummaryMock.mockResolvedValue(buildCheckoutSummary());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends anonymous visitors to login", () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });

    const { container } = renderCheckout();

    expect(routerReplaceMock).toHaveBeenCalledWith("/login");
    expect(container).toBeEmptyDOMElement();
    expect(getCheckoutSummaryMock).not.toHaveBeenCalled();
  });

  it("shows the booking summary with embedded payment methods", async () => {
    renderCheckout();

    expect(screen.getByText("Loading checkout")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        name: "Junction Team Offsite Loft",
      }),
    ).toBeInTheDocument();
    expect(getCheckoutSummaryMock).toHaveBeenCalledWith("booking-1");
    expect(
      screen.getByRole("heading", { name: /Pay .*275\.00/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sdk-methods")).toBeInTheDocument();
    expect(methodsPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: {
          clientId: "sandbox-client",
          environment: "sandbox",
          methods: ["paypal", "paypal_guest", "card"],
        },
        disabled: false,
      }),
    );
    expect(
      screen.getByRole("button", { name: /Pay on PayPal\.com/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to booking" }),
    ).toHaveAttribute("href", "/bookings/booking-1");
  });

  it("creates an order for the chosen method and captures the approved order", async () => {
    createSessionMock.mockResolvedValue(processingPayment());
    captureMock.mockResolvedValue(buildCheckoutPayment());

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(await screen.findByText("Payment confirmed")).toBeInTheDocument();
    expect(createSessionMock).toHaveBeenCalledWith("booking-1", {
      method: "card",
      idempotencyKey: expect.any(String),
    });
    expect(captureMock).toHaveBeenCalledWith("payment-1", {
      orderId: "ORDER-2",
    });
    expect(screen.getByRole("link", { name: "View booking" })).toHaveAttribute(
      "href",
      "/bookings/booking-1",
    );
  });

  it("disables the payment methods while an order is being created", async () => {
    let resolveSession: (value: unknown) => void = () => undefined;
    createSessionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "SDK pay" })).toBeDisabled(),
    );

    await act(async () => {
      resolveSession(
        buildCheckoutPayment({
          status: "failed_final",
          providerOrderId: undefined,
        }),
      );
    });
  });

  it("shows the capture overlay and blocks methods while confirming", async () => {
    createSessionMock.mockResolvedValue(processingPayment());
    let resolveCapture: (value: unknown) => void = () => undefined;
    captureMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCapture = resolve;
      }),
    );

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(
      await screen.findByText("Confirming payment..."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sdk-methods").parentElement).toHaveAttribute(
      "inert",
    );

    await act(async () => {
      resolveCapture(buildCheckoutPayment({ status: "processing" }));
    });

    expect(
      await screen.findByText("Payment still processing"),
    ).toBeInTheDocument();

    getByIdMock.mockResolvedValue(buildCheckoutPayment());
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(await screen.findByText("Payment confirmed")).toBeInTheDocument();
    expect(getByIdMock).toHaveBeenCalledWith("payment-1");
  });

  it("reports failures while checking a pending payment again", async () => {
    createSessionMock.mockResolvedValue(processingPayment());
    captureMock.mockResolvedValue(
      buildCheckoutPayment({ status: "processing" }),
    );
    getByIdMock.mockRejectedValue(new Error("offline"));

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't check your payment. Please try again.",
    );
  });

  it("explains a declined payment and lets the renter try again", async () => {
    createSessionMock.mockResolvedValue(processingPayment());
    captureMock.mockResolvedValue(
      buildCheckoutPayment({
        status: "failed_final",
        attempts: [
          buildPaymentAttempt({
            providerOrderId: "ORDER-2",
            failureCode: "CARD_AUTHENTICATION_FAILED",
          }),
        ],
      }),
    );

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your bank couldn't verify this card",
    );
    expect(screen.getByRole("button", { name: "SDK pay" })).toBeEnabled();
  });

  it("reports an order that could not be created", async () => {
    createSessionMock.mockResolvedValue(
      buildCheckoutPayment({
        status: "failed_final",
        providerOrderId: undefined,
        attempts: [buildPaymentAttempt({ failureMessage: "PayPal is down." })],
      }),
    );

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PayPal is down.",
    );
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("reports an order response without an order id", async () => {
    createSessionMock.mockResolvedValue(
      buildCheckoutPayment({
        status: "processing",
        providerOrderId: undefined,
      }),
    );

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't start checkout right now.",
    );
  });

  it("surfaces API errors when creating an order fails", async () => {
    createSessionMock.mockRejectedValue(
      new ApiClientError("This payment method is not available for checkout.", {
        status: 400,
        code: "BAD_REQUEST",
        request: { method: "POST", path: "/x", requestUrl: "/x" },
      }),
    );

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This payment method is not available for checkout.",
    );
  });

  it("retries once when another checkout request briefly holds the booking", async () => {
    createSessionMock
      .mockRejectedValueOnce(apiError(409, { reason: "checkout_busy" }))
      .mockResolvedValueOnce(processingPayment());
    captureMock.mockResolvedValue(buildCheckoutPayment());

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(
      await screen.findByText("Payment confirmed", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(createSessionMock).toHaveBeenCalledTimes(2);
  });

  it("reloads checkout when an earlier order was already paid", async () => {
    createSessionMock.mockRejectedValue(
      apiError(409, { reason: "payment_in_progress" }),
    );
    getCheckoutSummaryMock
      .mockResolvedValueOnce(buildCheckoutSummary())
      .mockResolvedValueOnce(
        buildCheckoutSummary({
          checkout: { eligible: false, reason: "already_paid" },
        }),
      );

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(
      await screen.findByText("This booking is already paid"),
    ).toBeInTheDocument();
    expect(getCheckoutSummaryMock).toHaveBeenCalledTimes(2);
  });

  it("tells the renter when a newer checkout replaced this order", async () => {
    createSessionMock.mockResolvedValue(processingPayment());
    captureMock.mockRejectedValue(apiError(409, { reason: "stale_order" }));

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(
      await screen.findByText("Checkout restarted elsewhere"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reload checkout" }));
    await waitFor(() =>
      expect(getCheckoutSummaryMock).toHaveBeenCalledTimes(2),
    );
  });

  it("explains when the captured booking needs reconciliation", async () => {
    createSessionMock.mockResolvedValue(processingPayment());
    captureMock.mockRejectedValue(
      apiError(409, { reason: "reconciliation_required" }),
    );

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(
      await screen.findByText("Payment received, booking under review"),
    ).toBeInTheDocument();
  });

  it("reports capture failures without claiming the payment failed", async () => {
    createSessionMock.mockResolvedValue(processingPayment());
    captureMock.mockRejectedValue(
      new ApiServerError("Service unavailable", {
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        request: { method: "POST", path: "/x", requestUrl: "/x" },
      }),
    );

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK pay" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "confirm your payment",
    );
  });

  it("returns to the payment methods when the buyer cancels or the SDK errors", async () => {
    createSessionMock.mockResolvedValue(processingPayment());

    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK cancel" }));
    expect(screen.queryByRole("status", { name: /cancelled/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "SDK open" }));
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "SDK cancel" }));
    expect(
      await screen.findByText(/Checkout was cancelled and nothing was charged/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "SDK open" }));
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "SDK error" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The payment didn't go through: Popup blocked",
    );

    fireEvent.click(screen.getByRole("button", { name: "SDK open" }));
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "SDK unknown error" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The payment didn't go through and nothing was charged.",
    );
  });

  it("ignores SDK errors when nothing is in progress", async () => {
    renderCheckout();

    fireEvent.click(await screen.findByRole("button", { name: "SDK error" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to the PayPal redirect when the SDK is unavailable", async () => {
    const assignSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: assignSpy },
    });
    createSessionMock.mockResolvedValue(processingPayment());

    try {
      renderCheckout();

      fireEvent.click(
        await screen.findByRole("button", { name: "SDK unavailable" }),
      );

      expect(screen.queryByTestId("sdk-methods")).not.toBeInTheDocument();
      expect(
        screen.getByText(/Payment options couldn't load on this page/),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Continue to PayPal" }),
      );

      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(
          "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-2",
        ),
      );
      expect(createSessionMock).toHaveBeenCalledWith("booking-1", {
        method: "paypal_redirect",
        idempotencyKey: expect.any(String),
      });
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("only offers the redirect when the frontend has no matching client id", async () => {
    getCheckoutSummaryMock.mockResolvedValue(
      buildCheckoutSummary({
        paypal: {
          clientId: "another-client",
          environment: "sandbox",
          enabledMethods: ["paypal"],
        },
      }),
    );
    createSessionMock.mockResolvedValue(
      buildCheckoutPayment({
        status: "failed_final",
        providerOrderId: undefined,
        attempts: [buildPaymentAttempt({ failureMessage: "PayPal is down." })],
      }),
    );

    renderCheckout();

    fireEvent.click(
      await screen.findByRole("button", { name: "Continue to PayPal" }),
    );

    expect(screen.queryByTestId("sdk-methods")).not.toBeInTheDocument();
    expect(
      screen.getByText(/finish paying securely on PayPal/),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PayPal is down.",
    );
  });

  it("reports redirect checkouts that could not start", async () => {
    getCheckoutSummaryMock.mockResolvedValue(
      buildCheckoutSummary({
        paypal: { clientId: "", environment: "sandbox", enabledMethods: [] },
      }),
    );
    createSessionMock
      .mockResolvedValueOnce(
        buildCheckoutPayment({ status: "processing", checkoutUrl: undefined }),
      )
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(apiError(409, { reason: "stale_order" }));

    renderCheckout();

    const redirect = await screen.findByRole("button", {
      name: "Continue to PayPal",
    });
    fireEvent.click(redirect);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't start checkout right now.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue to PayPal" }));
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Continue to PayPal" }));
    expect(
      await screen.findByText("Checkout restarted elsewhere"),
    ).toBeInTheDocument();
  });

  it.each([
    ["already_paid", "This booking is already paid"],
    ["reconciliation", "Payment received, booking under review"],
    ["hold_expired", "Your booking hold has expired"],
  ] as const)(
    "shows the %s state instead of payment methods",
    async (reason, title) => {
      getCheckoutSummaryMock.mockResolvedValue(
        buildCheckoutSummary({ checkout: { eligible: false, reason } }),
      );

      renderCheckout();

      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.queryByTestId("sdk-methods")).not.toBeInTheDocument();
    },
  );

  it.each(["converted", "not_payable"] as const)(
    "sends the renter back to the booking when checkout is %s",
    async (reason) => {
      getCheckoutSummaryMock.mockResolvedValue(
        buildCheckoutSummary({ checkout: { eligible: false, reason } }),
      );

      renderCheckout();

      expect(
        await screen.findByText("Returning to your booking"),
      ).toBeInTheDocument();
      expect(routerReplaceMock).toHaveBeenCalledWith("/bookings/booking-1");
    },
  );

  it.each([403, 404])(
    "sends anyone who cannot check out back to the booking (%s)",
    async (status) => {
      getCheckoutSummaryMock.mockRejectedValue(apiError(status));

      renderCheckout();

      await waitFor(() =>
        expect(routerReplaceMock).toHaveBeenCalledWith("/bookings/booking-1"),
      );
    },
  );

  it("offers to retry when the summary fails to load", async () => {
    getCheckoutSummaryMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(buildCheckoutSummary());

    renderCheckout();

    expect(
      await screen.findByText("We couldn't load checkout"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", {
        name: "Junction Team Offsite Loft",
      }),
    ).toBeInTheDocument();
  });

  it("refreshes the summary when the tab becomes visible again", async () => {
    renderCheckout();

    await screen.findByTestId("sdk-methods");

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() =>
      expect(getCheckoutSummaryMock).toHaveBeenCalledTimes(2),
    );
  });

  it("hides payment methods and re-checks the hold when it expires", async () => {
    const expiresSoon = buildCheckoutSummary();
    expiresSoon.serverTime = new Date().toISOString();
    expiresSoon.booking.holdExpiresAt = new Date(
      Date.now() + 1500,
    ).toISOString();
    let resolveRefresh: (value: unknown) => void = () => undefined;
    getCheckoutSummaryMock
      .mockResolvedValueOnce(expiresSoon)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );

    renderCheckout();

    await screen.findByTestId("sdk-methods");

    expect(
      await screen.findByText(
        "Checking your booking hold...",
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("sdk-methods")).not.toBeInTheDocument();

    await act(async () => {
      resolveRefresh(
        buildCheckoutSummary({
          checkout: { eligible: false, reason: "hold_expired" },
        }),
      );
    });

    expect(
      await screen.findByText("Your booking hold has expired"),
    ).toBeInTheDocument();
  });
});
