"use client";

import Script from "next/script";
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
  ApplePayOneTimePaymentButton,
  GooglePayOneTimePaymentButton,
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

/** How long the SDK may take to load before checkout falls back to redirect. */
export const PAYPAL_SDK_LOAD_TIMEOUT_MS = 15_000;
const APPLE_PAY_SDK_URL =
  "https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js";
const GOOGLE_PAY_SDK_URL = "https://pay.google.com/gp/p/js/pay.js";
const APPLE_PAY_SESSION_VERSION = 4;
/** Rentify merchants are Canadian; PayPal's config usually says so already. */
const DEFAULT_MERCHANT_COUNTRY = "CA";

const COMPONENTS_BY_METHOD: Record<CheckoutPaymentMethod, Components> = {
  paypal: "paypal-payments",
  paypal_guest: "paypal-guest-payments",
  card: "card-fields",
  apple_pay: "applepay-payments",
  google_pay: "googlepay-payments",
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
  const applePayConfig =
    enabled.has("apple_pay") && isEligible("applepay")
      ? eligiblePaymentMethods?.getDetails("applepay").config
      : undefined;
  const googlePayConfig =
    enabled.has("google_pay") && isEligible("googlepay")
      ? eligiblePaymentMethods?.getDetails("googlepay").config
      : undefined;

  return (
    <div className="grid gap-3">
      {applePayConfig ? (
        <ApplePayMethod
          config={applePayConfig}
          summary={summary}
          handlers={handlers}
        />
      ) : null}
      {googlePayConfig ? (
        <GooglePayMethod
          config={googlePayConfig}
          environment={config.environment}
          summary={summary}
          handlers={handlers}
          disabled={disabled}
        />
      ) : null}
      {enabled.has("paypal") ? (
        <PayPalOneTimePaymentButton
          createOrder={createOrderFor("paypal")}
          onApprove={approve}
          onCancel={handlers.cancel}
          onError={handlers.fail}
          disabled={disabled}
        />
      ) : null}
      {showPayLater ? (
        <PayLaterOneTimePaymentButton
          createOrder={createOrderFor("paypal")}
          onApprove={approve}
          onCancel={handlers.cancel}
          onError={handlers.fail}
          disabled={disabled}
        />
      ) : null}
      {showGuest ? (
        <PayPalGuestPaymentButton
          createOrder={createOrderFor("paypal_guest")}
          onApprove={approve}
          onCancel={handlers.cancel}
          onError={handlers.fail}
          disabled={disabled}
        />
      ) : null}
      {showCardFields ? (
        <PayPalCardFieldsProvider
          amount={{
            value: pricing.totalDueNow.toFixed(2),
            currencyCode: pricing.currency,
          }}
        >
          <CardFieldsForm handlers={handlers} disabled={disabled} />
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
}: {
  handlers: CheckoutPaymentHandlers;
  disabled: boolean;
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

  const fieldClass = "min-h-12";

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="grid gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700"
      aria-label="Pay with a credit or debit card"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
        <CreditCard aria-hidden="true" className="h-4 w-4" />
        Credit or debit card
      </p>
      <PayPalCardNameField
        placeholder="Name on card"
        containerClassName={fieldClass}
      />
      <PayPalCardNumberField
        placeholder="Card number"
        containerClassName={fieldClass}
      />
      <div className="grid grid-cols-2 gap-3">
        <PayPalCardExpiryField
          placeholder="MM/YY"
          containerClassName={fieldClass}
        />
        <PayPalCardCvvField placeholder="CVV" containerClassName={fieldClass} />
      </div>
      <button
        type="submit"
        disabled={disabled || submitting}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
      >
        {submitting ? "Processing card..." : "Pay with card"}
      </button>
    </form>
  );
}

function ApplePayMethod({
  config,
  summary,
  handlers,
}: {
  config: Parameters<typeof ApplePayOneTimePaymentButton>[0]["applePayConfig"];
  summary: CheckoutSummary;
  handlers: CheckoutPaymentHandlers;
}) {
  const [scriptReady, setScriptReady] = useState(false);
  const { pricing } = summary;

  return (
    <>
      <Script src={APPLE_PAY_SDK_URL} onReady={() => setScriptReady(true)} />
      {scriptReady ? (
        <ApplePayOneTimePaymentButton
          applePayConfig={config}
          applePaySessionVersion={APPLE_PAY_SESSION_VERSION}
          paymentRequest={{
            countryCode: config.merchantCountry ?? DEFAULT_MERCHANT_COUNTRY,
            currencyCode: pricing.currency,
            total: {
              label: "Rentify",
              amount: pricing.totalDueNow.toFixed(2),
              type: "final",
            },
          }}
          createOrder={() => handlers.createOrder("apple_pay")}
          onApprove={(data) => handlers.approve(data.approveApplePayPayment.id)}
          onCancel={handlers.cancel}
          onError={handlers.fail}
          buttonstyle="black"
          type="pay"
        />
      ) : null}
    </>
  );
}

function GooglePayMethod({
  config,
  environment,
  summary,
  handlers,
  disabled,
}: {
  config: Parameters<
    typeof GooglePayOneTimePaymentButton
  >[0]["googlePayConfig"];
  environment: PayPalSdkConfig["environment"];
  summary: CheckoutSummary;
  handlers: CheckoutPaymentHandlers;
  disabled: boolean;
}) {
  const [scriptReady, setScriptReady] = useState(false);
  const { pricing } = summary;

  return (
    <>
      <Script src={GOOGLE_PAY_SDK_URL} onReady={() => setScriptReady(true)} />
      {scriptReady ? (
        <GooglePayOneTimePaymentButton
          googlePayConfig={config}
          environment={environment === "production" ? "PRODUCTION" : "TEST"}
          transactionInfo={{
            countryCode: config.merchantCountry || DEFAULT_MERCHANT_COUNTRY,
            currencyCode: pricing.currency,
            totalPriceStatus: "FINAL",
            totalPrice: pricing.totalDueNow.toFixed(2),
          }}
          createOrder={() => handlers.createOrder("google_pay")}
          onApprove={(data) => handlers.approve(data.id)}
          onCancel={handlers.cancel}
          onError={handlers.fail}
          buttonType="pay"
          buttonColor="black"
          buttonSizeMode="fill"
          disabled={disabled}
        />
      ) : null}
    </>
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
