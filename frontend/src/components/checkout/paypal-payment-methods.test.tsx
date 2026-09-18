import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCheckoutSummary } from "@/test/mocks/checkout";
import { formatMoney } from "@/lib/rentings/format";
import type { PayPalSdkConfig } from "@/lib/checkout/paypal-config";
import {
  PAYPAL_SDK_LOAD_TIMEOUT_MS,
  PayPalPaymentMethods,
  type CheckoutPaymentHandlers,
} from "./paypal-payment-methods";

type ButtonProps = {
  createOrder: () => Promise<{ orderId: string }>;
  onApprove: (data: Record<string, unknown>) => Promise<void> | void;
  onCancel?: () => void;
  onError?: (error: Error) => void;
  disabled?: boolean;
};

const sdk = vi.hoisted(() => ({
  providerProps: vi.fn(),
  loadingStatus: "resolved",
  eligibility: {
    isLoading: false,
    eligible: new Set<string>(["paylater", "card", "advanced_cards"]),
    details: {} as Record<string, unknown>,
    missing: false,
  },
  cardFields: {
    submit: vi.fn(),
    submitResponse: null as unknown,
    error: null as Error | null,
  },
  throwInProvider: false,
}));

function MockButton({ label, ...props }: ButtonProps & { label: string }) {
  return (
    <div>
      <button
        type="button"
        disabled={props.disabled}
        onClick={async () => {
          const { orderId } = await props.createOrder();
          await props.onApprove({ orderId });
        }}
      >
        {label}
      </button>
      <button type="button" onClick={() => props.onCancel?.()}>
        {`${label} cancel`}
      </button>
      <button type="button" onClick={() => props.onError?.(new Error("boom"))}>
        {`${label} error`}
      </button>
    </div>
  );
}

vi.mock("@paypal/react-paypal-js/sdk-v6", () => ({
  INSTANCE_LOADING_STATE: {
    PENDING: "pending",
    RESOLVED: "resolved",
    REJECTED: "rejected",
  },
  PayPalProvider: ({ children, ...props }: { children: React.ReactNode }) => {
    sdk.providerProps(props);
    if (sdk.throwInProvider) {
      throw new Error("SDK render failure");
    }
    return <>{children}</>;
  },
  usePayPal: () => ({ loadingStatus: sdk.loadingStatus }),
  useEligibleMethods: () => ({
    isLoading: sdk.eligibility.isLoading,
    eligiblePaymentMethods: sdk.eligibility.missing
      ? null
      : {
          isEligible: (source: string) => sdk.eligibility.eligible.has(source),
          getDetails: (source: string) => sdk.eligibility.details[source],
        },
  }),
  PayPalOneTimePaymentButton: (props: ButtonProps) => (
    <MockButton label="PayPal" {...props} />
  ),
  PayLaterOneTimePaymentButton: (props: ButtonProps) => (
    <MockButton label="Pay Later" {...props} />
  ),
  PayPalGuestPaymentButton: (props: ButtonProps) => (
    <MockButton label="Guest card" {...props} />
  ),
  PayPalCardFieldsProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PayPalCardNameField: () => <div data-testid="card-name" />,
  PayPalCardNumberField: () => <div data-testid="card-number" />,
  PayPalCardExpiryField: () => <div data-testid="card-expiry" />,
  PayPalCardCvvField: () => <div data-testid="card-cvv" />,
  usePayPalCardFieldsOneTimePaymentSession: () => sdk.cardFields,
}));

// The currency symbol depends on the runtime's locale data, so the card
// button's label is built with the same formatter the component uses.
const PAY_BUTTON_NAME = `Pay ${formatMoney(275, "CAD")}`;

const CONFIG: PayPalSdkConfig = {
  clientId: "sandbox-client",
  environment: "sandbox",
  methods: ["paypal", "paypal_guest", "card"],
};

function createHandlers() {
  return {
    createOrder: vi.fn<CheckoutPaymentHandlers["createOrder"]>(async () => ({
      orderId: "ORDER-1",
    })),
    approve: vi.fn<CheckoutPaymentHandlers["approve"]>(async () => undefined),
    cancel: vi.fn<CheckoutPaymentHandlers["cancel"]>(),
    fail: vi.fn<CheckoutPaymentHandlers["fail"]>(),
  };
}

function renderMethods(
  overrides: Partial<{
    config: PayPalSdkConfig;
    handlers: CheckoutPaymentHandlers;
    disabled: boolean;
    onUnavailable: () => void;
  }> = {},
) {
  const handlers = overrides.handlers ?? createHandlers();
  const onUnavailable = overrides.onUnavailable ?? vi.fn();
  const props = {
    config: overrides.config ?? CONFIG,
    summary: buildCheckoutSummary(),
    handlers,
    disabled: overrides.disabled ?? false,
    onUnavailable,
  };

  return {
    ...render(<PayPalPaymentMethods {...props} />),
    rerenderWith: (next: typeof props) =>
      render(<PayPalPaymentMethods {...next} />),
    handlers,
    onUnavailable,
    props,
  };
}

describe("PayPalPaymentMethods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.loadingStatus = "resolved";
    sdk.throwInProvider = false;
    sdk.eligibility = {
      isLoading: false,
      eligible: new Set(["paylater", "card", "advanced_cards"]),
      details: {},
      missing: false,
    };
    sdk.cardFields = { submit: vi.fn(), submitResponse: null, error: null };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads only the SDK components for the enabled methods", () => {
    renderMethods();

    expect(sdk.providerProps).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "sandbox-client",
        environment: "sandbox",
        pageType: "checkout",
        components: ["paypal-payments", "paypal-guest-payments", "card-fields"],
      }),
    );
  });

  it("offers PayPal, Pay Later, and card fields when eligible", async () => {
    const { handlers } = renderMethods();

    expect(
      screen.getByRole("button", { name: "Pay Later" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-number")).toBeInTheDocument();
    expect(screen.getByText("Or pay with card")).toBeInTheDocument();
    // PayPal's own card button would duplicate the card form.
    expect(screen.queryByRole("button", { name: "Guest card" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "PayPal" }));
    });

    expect(handlers.createOrder).toHaveBeenCalledWith("paypal");
    expect(handlers.approve).toHaveBeenCalledWith("ORDER-1");

    fireEvent.click(screen.getByRole("button", { name: "PayPal cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "PayPal error" }));
    expect(handlers.cancel).toHaveBeenCalled();
    expect(handlers.fail).toHaveBeenCalledWith(expect.any(Error));
  });

  it("offers PayPal's guest card button when card fields are not eligible", async () => {
    sdk.eligibility.eligible = new Set(["card"]);
    const { handlers } = renderMethods();

    expect(screen.queryByTestId("card-number")).toBeNull();
    expect(screen.queryByText("Or pay with card")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guest card" }));
    });

    expect(handlers.createOrder).toHaveBeenCalledWith("paypal_guest");
  });

  it("only offers the PayPal button without an eligibility answer", () => {
    sdk.eligibility.missing = true;

    renderMethods();

    expect(screen.getByRole("button", { name: "PayPal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay Later" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Guest card" })).toBeNull();
    expect(screen.queryByTestId("card-number")).toBeNull();
  });

  it("disables the buttons while checkout is busy", () => {
    renderMethods({ disabled: true });

    expect(screen.getByRole("button", { name: "PayPal" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: PAY_BUTTON_NAME }),
    ).toBeDisabled();
  });

  it("shows a loader while the SDK or eligibility is loading", () => {
    sdk.eligibility.isLoading = true;

    renderMethods();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading payment options...",
    );
  });

  it("reports the SDK unavailable when it fails or takes too long to load", () => {
    sdk.loadingStatus = "rejected";
    const rejected = renderMethods();
    expect(rejected.onUnavailable).toHaveBeenCalledTimes(1);
    rejected.unmount();

    vi.useFakeTimers();
    sdk.loadingStatus = "pending";
    const slow = renderMethods();

    act(() => {
      vi.advanceTimersByTime(PAYPAL_SDK_LOAD_TIMEOUT_MS - 1);
    });
    expect(slow.onUnavailable).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(slow.onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("reports the SDK unavailable when it throws while rendering", () => {
    sdk.throwInProvider = true;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { onUnavailable, container } = renderMethods();

    expect(onUnavailable).toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    consoleError.mockRestore();
  });

  describe("card fields", () => {
    it("creates a card order and submits it to PayPal", async () => {
      const { handlers } = renderMethods();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: PAY_BUTTON_NAME }));
      });

      expect(handlers.createOrder).toHaveBeenCalledWith("card");
      expect(sdk.cardFields.submit).toHaveBeenCalledWith("ORDER-1");
    });

    it("does not submit when the order could not be created", async () => {
      const handlers = createHandlers();
      handlers.createOrder.mockRejectedValue(new Error("no order"));

      renderMethods({ handlers });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: PAY_BUTTON_NAME }));
      });

      expect(sdk.cardFields.submit).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: PAY_BUTTON_NAME }),
      ).toBeEnabled();
    });

    it.each([
      [{ state: "succeeded", data: { orderId: "ORDER-7" } }, "approve"],
      [{ state: "canceled", data: { orderId: "ORDER-7" } }, "cancel"],
      [{ state: "failed", data: { orderId: "ORDER-7" } }, "fail"],
      [
        { state: "failed", data: { orderId: "ORDER-7", message: "Declined" } },
        "fail",
      ],
    ] as const)(
      "reports the submit outcome %j once",
      (response, handlerName) => {
        const handlers = createHandlers();
        sdk.cardFields.submitResponse = response;

        const { rerender } = render(
          <PayPalPaymentMethods
            config={CONFIG}
            summary={buildCheckoutSummary()}
            handlers={handlers}
            disabled={false}
            onUnavailable={vi.fn()}
          />,
        );
        rerender(
          <PayPalPaymentMethods
            config={CONFIG}
            summary={buildCheckoutSummary()}
            handlers={handlers}
            disabled
            onUnavailable={vi.fn()}
          />,
        );

        expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
        if (handlerName === "approve") {
          expect(handlers.approve).toHaveBeenCalledWith("ORDER-7");
        }
      },
    );

    it("reports card field errors once", () => {
      const handlers = createHandlers();
      sdk.cardFields.error = new Error("Invalid card number");

      const { rerender } = renderMethods({ handlers });
      rerender(
        <PayPalPaymentMethods
          config={CONFIG}
          summary={buildCheckoutSummary()}
          handlers={handlers}
          disabled
          onUnavailable={vi.fn()}
        />,
      );

      expect(handlers.fail).toHaveBeenCalledTimes(1);
      expect(handlers.fail).toHaveBeenCalledWith(sdk.cardFields.error);
    });
  });
});
