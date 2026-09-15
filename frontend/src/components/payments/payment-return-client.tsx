"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { ApiError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { paymentsApi, type PaymentRecord } from "@/lib/payments/api";
import { formatDateRange, formatMoney } from "@/lib/rentings/format";
import { theme } from "@/styles/theme";

type ReturnState =
  | { kind: "capturing" }
  | { kind: "succeeded"; payment: PaymentRecord }
  | { kind: "pending"; payment: PaymentRecord }
  | { kind: "failed"; payment: PaymentRecord }
  | { kind: "reconciliation" }
  | { kind: "error"; message: string };

const SECONDARY_BUTTON_CLASS =
  "inline-flex h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition duration-200 hover:border-violet-200 hover:bg-violet-50/70 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:border-violet-800 dark:hover:bg-violet-950/40";

const CAPTURED_STATUSES = new Set([
  "succeeded",
  "refunded",
  "partially_refunded",
]);
const FAILED_STATUSES = new Set([
  "failed_retryable",
  "failed_final",
  "cancelled",
]);

function stateForPayment(payment: PaymentRecord): ReturnState {
  if (CAPTURED_STATUSES.has(payment.status)) {
    return { kind: "succeeded", payment };
  }

  if (FAILED_STATUSES.has(payment.status)) {
    return { kind: "failed", payment };
  }

  return { kind: "pending", payment };
}

interface PaymentReturnClientProps {
  paymentId: string;
  /** PayPal sends the buyer back with ?cancelled=1 when they abandon checkout. */
  cancelled: boolean;
}

export function PaymentReturnClient({
  paymentId,
  cancelled,
}: PaymentReturnClientProps) {
  const router = useRouter();
  const { status } = useAuth();
  const [state, setState] = useState<ReturnState>({ kind: "capturing" });
  const [retrying, setRetrying] = useState(false);
  // Capturing is idempotent server-side, but StrictMode's double effect would
  // still fire a second request; start the capture once per payment.
  const captureStartedFor = useRef<string | null>(null);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [router, status]);

  const capture = useCallback(async () => {
    setState({ kind: "capturing" });

    try {
      setState(stateForPayment(await paymentsApi.capture(paymentId)));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setState({ kind: "reconciliation" });
        return;
      }

      setState({
        kind: "error",
        message: getApiErrorMessage(error, {
          action: "confirm your payment",
          fallback: "We couldn't confirm your payment. Please try again.",
        }),
      });
    }
  }, [paymentId]);

  useEffect(() => {
    if (
      cancelled ||
      status !== "authenticated" ||
      captureStartedFor.current === paymentId
    ) {
      return;
    }

    captureStartedFor.current = paymentId;
    void capture();
  }, [cancelled, capture, paymentId, status]);

  const restartCheckout = useCallback(async () => {
    setRetrying(true);

    try {
      const payment = await paymentsApi.retry(paymentId);

      if (payment.status === "processing" && payment.checkoutUrl) {
        window.location.assign(payment.checkoutUrl);
        return;
      }

      setState(stateForPayment(payment));
    } catch (error) {
      setState({
        kind: "error",
        message: getApiErrorMessage(error, {
          action: "restart checkout",
          fallback: "We couldn't restart checkout. Please try again.",
        }),
      });
    } finally {
      setRetrying(false);
    }
  }, [paymentId]);

  if (status === "anonymous") {
    return null;
  }

  const backToBookings = (
    <Link href="/bookings" className={SECONDARY_BUTTON_CLASS}>
      Back to bookings
    </Link>
  );

  if (cancelled) {
    return (
      <ReturnPanel
        icon={<AlertTriangle className="h-10 w-10 text-amber-500" />}
        title="Payment cancelled"
        description="You left PayPal before approving the payment, so nothing was charged. Your booking request is still waiting for payment."
      >
        {backToBookings}
      </ReturnPanel>
    );
  }

  if (status === "loading" || state.kind === "capturing") {
    return (
      <ReturnPanel
        icon={<Loader2 className="h-10 w-10 animate-spin text-violet-500" />}
        title="Confirming your payment"
        description="Hold tight while we confirm your payment with PayPal."
      />
    );
  }

  switch (state.kind) {
    case "succeeded":
      return (
        <ReturnPanel
          icon={<CheckCircle2 className="h-10 w-10 text-emerald-500" />}
          title="Payment confirmed"
          description={`We received ${formatMoney(state.payment.totalAmount, state.payment.pricingCurrency)} for your stay on ${formatDateRange(state.payment.booking.startAt, state.payment.booking.endAt)}.`}
        >
          <Link href="/bookings" className={theme.marketplace.primaryButton}>
            View bookings
          </Link>
        </ReturnPanel>
      );
    case "pending":
      return (
        <ReturnPanel
          icon={<Clock className="h-10 w-10 text-sky-500" />}
          title="Payment still processing"
          description="PayPal hasn't finished processing this payment yet. This can take a few minutes."
        >
          <button
            type="button"
            onClick={() => void capture()}
            className={theme.marketplace.primaryButton}
          >
            Check again
          </button>
          {backToBookings}
        </ReturnPanel>
      );
    case "failed":
      return (
        <ReturnPanel
          icon={<AlertTriangle className="h-10 w-10 text-rose-500" />}
          title="Payment didn't go through"
          description={
            state.payment.attempts[0]?.failureMessage ??
            "PayPal couldn't complete this payment. You can try again with another payment method."
          }
        >
          <button
            type="button"
            onClick={() => void restartCheckout()}
            disabled={retrying}
            className={theme.marketplace.primaryButton}
          >
            {retrying ? "Restarting checkout..." : "Try again with PayPal"}
          </button>
          {backToBookings}
        </ReturnPanel>
      );
    case "reconciliation":
      return (
        <ReturnPanel
          icon={<AlertTriangle className="h-10 w-10 text-amber-500" />}
          title="Payment received, booking under review"
          description="Your payment went through, but the booking needs to be reconciled before it can be confirmed. We'll follow up once it's resolved."
        >
          {backToBookings}
        </ReturnPanel>
      );
    case "error":
      return (
        <ReturnPanel
          icon={<AlertTriangle className="h-10 w-10 text-rose-500" />}
          title="We couldn't confirm your payment"
          description={state.message}
        >
          <button
            type="button"
            onClick={() => void capture()}
            className={theme.marketplace.primaryButton}
          >
            Try again
          </button>
          {backToBookings}
        </ReturnPanel>
      );
  }
}

function ReturnPanel({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.container}>
        <section
          aria-live="polite"
          className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center shadow-xl shadow-slate-950/5 sm:p-10"
        >
          <div className="flex justify-center" aria-hidden="true">
            {icon}
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-3xl">
            {title}
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {description}
          </p>
          {children ? (
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              {children}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
