"use client";

import {
  Component,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { CreditCard, Loader2 } from "lucide-react";
import {
  INSTANCE_LOADING_STATE,
  PayLaterOneTimePaymentButton,
  PayPalCardCvvField,
  PayPalCardExpiryField,
  PayPalCardFieldsProvider,
  PayPalCardNameField,
  PayPalCardNumberField,
  PayPalGuestPaymentButton,
  PayPalOneTimePaymentButton,
  PayPalProvider,
  useEligibleMethods,
  usePayPal,
  usePayPalCardFieldsOneTimePaymentSession,
  type Components,
} from "@paypal/react-paypal-js/sdk-v6";
import type { PayPalSdkConfig } from "@/lib/checkout/paypal-config";
import type {
  CheckoutPaymentMethod,
  CheckoutSummary,
} from "@/lib/payments/api";
import { formatMoney } from "@/lib/rentings/format";

/** How long the SDK may take to load before checkout falls back to redirect. */
export const PAYPAL_SDK_LOAD_TIMEOUT_MS = 15_000;
const FULL_WIDTH_BUTTON_CLASS =
  "[&>paypal-button]:!w-full [&>paypal-pay-later-button]:!w-full [&>paypal-basic-card-container]:!w-full [&_paypal-basic-card-button]:!w-full";

// PayPal renders each card field in its own iframe, so the input is styled
// through the SDK while the box around it is ours.
const CARD_FIELD_CONTAINER_CLASS =
  "h-11 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-600 dark:bg-slate-950";
const CARD_FIELD_STYLE = {
  input: {
    "font-family":
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    "font-size": "15px",
    color: "#0f172a",
  },
  ".invalid": {
    color: "#be123c",
  },
};

const COMPONENTS_BY_METHOD: Record<CheckoutPaymentMethod, Components> = {
  paypal: "paypal-payments",
  paypal_guest: "paypal-guest-payments",
  card: "card-fields",
};

/**
 * What every payment method calls. The checkout client owns the requests and
 * state; the SDK components only report what the buyer did.
 */
export interface CheckoutPaymentHandlers {
  createOrder: (method: CheckoutPaymentMethod) => Promise<{ orderId: string }>;
  approve: (orderId: string) => Promise<void>;
  cancel: () => void;
  fail: (error: unknown) => void;
}

interface PayPalPaymentMethodsProps {
  config: PayPalSdkConfig;
  summary: CheckoutSummary;
  handlers: CheckoutPaymentHandlers;
  disabled: boolean;
  /** Called when the SDK cannot be used, so the page offers the redirect. */
  onUnavailable: () => void;
}

export function PayPalPaymentMethods({
  config,
  summary,
  handlers,
  disabled,
  onUnavailable,
}: PayPalPaymentMethodsProps) {
  const components = config.methods.map(
    (method) => COMPONENTS_BY_METHOD[method],
  );

  return (
    <PayPalSdkErrorBoundary onError={onUnavailable}>
      <PayPalProvider
        clientId={config.clientId}
        environment={config.environment}
        components={components}
        pageType="checkout"
      >
        <PaymentMethodList
          config={config}
          summary={summary}
          handlers={handlers}
          disabled={disabled}
          onUnavailable={onUnavailable}
        />
      </PayPalProvider>
    </PayPalSdkErrorBoundary>
  );
}

function PaymentMethodList({
  config,
  summary,
  handlers,
  disabled,
  onUnavailable,
}: PayPalPaymentMethodsProps) {
  const { loadingStatus } = usePayPal();
  const { pricing } = summary;
  const { eligiblePaymentMethods, isLoading } = useEligibleMethods({
    payload: {
      currencyCode: pricing.currency,
      amount: pricing.totalDueNow.toFixed(2),
    },
  });
  const reportedUnavailable = useRef(false);

  useEffect(() => {
    if (
      reportedUnavailable.current ||
      loadingStatus === INSTANCE_LOADING_STATE.RESOLVED
    ) {
      return;
    }

    const reportUnavailable = () => {
      reportedUnavailable.current = true;
      onUnavailable();
    };

    if (loadingStatus === INSTANCE_LOADING_STATE.REJECTED) {
      reportUnavailable();
      return;
    }

    const timer = setTimeout(reportUnavailable, PAYPAL_SDK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loadingStatus, onUnavailable]);

  if (loadingStatus !== INSTANCE_LOADING_STATE.RESOLVED || isLoading) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 py-6 text-sm text-slate-500 dark:text-slate-400"
      >
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Loading payment options...
      </div>
    );
  }

  const enabled = new Set(config.methods);
  // Without an eligibility answer only the PayPal button is safe to offer.
  const isEligible = (
    fundingSource: Parameters<
      NonNullable<typeof eligiblePaymentMethods>["isEligible"]
    >[0],
  ) => eligiblePaymentMethods?.isEligible(fundingSource) ?? false;
  const approve = async ({ orderId }: { orderId: string }) =>
    handlers.approve(orderId);
  const createOrderFor = (method: CheckoutPaymentMethod) => () =>
    handlers.createOrder(method);

  const showPayLater = enabled.has("paypal") && isEligible("paylater");
  const showGuest = enabled.has("paypal_guest") && isEligible("card");
  const showCardFields = enabled.has("card") && isEligible("advanced_cards");

  const wallets = [
    enabled.has("paypal") ? (
      <PayPalOneTimePaymentButton
        key="paypal"
        createOrder={createOrderFor("paypal")}
        onApprove={approve}
        onCancel={handlers.cancel}
        onError={handlers.fail}
        disabled={disabled}
      />
    ) : null,
    showPayLater ? (
      <PayLaterOneTimePaymentButton
        key="paylater"
        createOrder={createOrderFor("paypal")}
        onApprove={approve}
        onCancel={handlers.cancel}
        onError={handlers.fail}
        disabled={disabled}
      />
    ) : null,
    showGuest && !showCardFields ? (
      <PayPalGuestPaymentButton
        key="guest"
        createOrder={createOrderFor("paypal_guest")}
        onApprove={approve}
        onCancel={handlers.cancel}
        onError={handlers.fail}
        disabled={disabled}
      />
    ) : null,
  ].filter(Boolean);

  return (
    <div className="grid gap-5">
      {wallets.length > 0 ? (
        // PayPal's web components size themselves (225px), which leaves a gap
        // beside them in a wider column, so the hosts are stretched to fill it.
        <div className={`grid gap-2 ${FULL_WIDTH_BUTTON_CLASS}`}>{wallets}</div>
      ) : null}

      {wallets.length > 0 && showCardFields ? (
        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Or pay with card
          </span>
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        </div>
      ) : null}

      {showCardFields ? (
        <PayPalCardFieldsProvider
          amount={{
            value: pricing.totalDueNow.toFixed(2),
            currencyCode: pricing.currency,
          }}
        >
          <CardFieldsForm
            handlers={handlers}
            disabled={disabled}
            total={formatMoney(pricing.totalDueNow, pricing.currency)}
          />
        </PayPalCardFieldsProvider>
      ) : null}
    </div>
  );
}

/**
 * Credit and debit card entry. PayPal hosts each field, and `submit` runs any
 * 3-D Secure challenge before reporting the outcome.
 */
function CardFieldsForm({
  handlers,
  disabled,
  total,
}: {
  handlers: CheckoutPaymentHandlers;
  disabled: boolean;
  total: string;
}) {
  const { submit, submitResponse, error } =
    usePayPalCardFieldsOneTimePaymentSession();
  const [submitting, setSubmitting] = useState(false);
  const handledResponse = useRef<unknown>(null);
  const handledError = useRef<unknown>(null);

  useEffect(() => {
    if (!submitResponse || handledResponse.current === submitResponse) {
      return;
    }

    handledResponse.current = submitResponse;

    switch (submitResponse.state) {
      case "succeeded":
        void handlers.approve(submitResponse.data.orderId);
        break;
      case "canceled":
        handlers.cancel();
        break;
      case "failed":
        handlers.fail(
          new Error(
            submitResponse.data.message ??
              "Your card could not be charged. Check the details or use another card.",
          ),
        );
        break;
    }
  }, [handlers, submitResponse]);

  useEffect(() => {
    if (!error || handledError.current === error) {
      return;
    }

    handledError.current = error;
    handlers.fail(error);
  }, [error, handlers]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const { orderId } = await handlers.createOrder("card");
      await submit(orderId);
    } catch {
      // createOrder already reported why checkout could not start.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="grid gap-3"
      aria-label="Pay with a credit or debit card"
    >
      <CardFieldRow label="Name on card">
        <PayPalCardNameField
          placeholder="Full name"
          style={CARD_FIELD_STYLE}
          containerClassName={CARD_FIELD_CONTAINER_CLASS}
        />
      </CardFieldRow>
      <CardFieldRow label="Card number">
        <PayPalCardNumberField
          placeholder="1234 1234 1234 1234"
          style={CARD_FIELD_STYLE}
          containerClassName={CARD_FIELD_CONTAINER_CLASS}
        />
      </CardFieldRow>
      <div className="grid grid-cols-2 gap-3">
        <CardFieldRow label="Expiry">
          <PayPalCardExpiryField
            placeholder="MM / YY"
            style={CARD_FIELD_STYLE}
            containerClassName={CARD_FIELD_CONTAINER_CLASS}
          />
        </CardFieldRow>
        <CardFieldRow label="Security code">
          <PayPalCardCvvField
            placeholder="CVC"
            style={CARD_FIELD_STYLE}
            containerClassName={CARD_FIELD_CONTAINER_CLASS}
          />
        </CardFieldRow>
      </div>
      <button
        type="submit"
        disabled={disabled || submitting}
        className="mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
      >
        {submitting ? (
          "Processing card..."
        ) : (
          <>
            <CreditCard aria-hidden="true" className="h-4 w-4" />
            {`Pay ${total}`}
          </>
        )}
      </button>
    </form>
  );
}

function CardFieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Keeps an SDK render failure from taking the whole checkout page down. */
class PayPalSdkErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
