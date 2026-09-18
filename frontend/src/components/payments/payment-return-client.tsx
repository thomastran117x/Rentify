"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import {
  PaymentOutcomePanel,
  SECONDARY_OUTCOME_BUTTON_CLASS,
} from "@/components/payments/payment-outcome";
import { checkoutPath } from "@/lib/bookings/actions";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  CAPTURED_PAYMENT_STATUSES,
  FAILED_PAYMENT_STATUSES,
  conflictReason,
  declineMessage,
} from "@/lib/checkout/state";
import { paymentsApi, type PaymentRecord } from "@/lib/payments/api";
import { formatDateRange, formatMoney } from "@/lib/rentings/format";
import { theme } from "@/styles/theme";

type ReturnState =
  | { kind: "loading" }
  | { kind: "succeeded"; payment: PaymentRecord }
  | { kind: "pending"; payment: PaymentRecord }
  | { kind: "failed"; payment: PaymentRecord }
  | { kind: "cancelled"; payment: PaymentRecord }
  | { kind: "superseded" }
  | { kind: "reconciliation" }
  | { kind: "error"; message: string };

function stateForPayment(payment: PaymentRecord): ReturnState {
  if (CAPTURED_PAYMENT_STATUSES.has(payment.status)) {
    return { kind: "succeeded", payment };
  }

  if (FAILED_PAYMENT_STATUSES.has(payment.status)) {
    return { kind: "failed", payment };
  }

  return { kind: "pending", payment };
}

interface PaymentReturnClientProps {
  paymentId: string;
  /** PayPal sends the buyer back with ?cancelled=1 when they abandon checkout. */
  cancelled: boolean;
  /** The PayPal order id PayPal appends as ?token= on the return URL. */
  orderId?: string;
}

export function PaymentReturnClient({
  paymentId,
  cancelled,
  orderId,
}: PaymentReturnClientProps) {
  const router = useRouter();
  const { status } = useAuth();
  const [state, setState] = useState<ReturnState>({ kind: "loading" });
  // Both calls are idempotent server-side, but StrictMode's double effect
  // would still fire a second request; start once per return visit.
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [router, status]);

  // A normal return captures the approved order. A cancelled return records the
  // abandoned checkout so the renter can restart it; if PayPal shows the order
  // was paid after all, the backend reports that instead.
  const confirm = useCallback(async () => {
    setState({ kind: "loading" });

    try {
      if (cancelled) {
        const payment = await paymentsApi.cancelCheckout(paymentId, {
          orderId,
        });
        setState(
          FAILED_PAYMENT_STATUSES.has(payment.status)
            ? { kind: "cancelled", payment }
            : stateForPayment(payment),
        );
        return;
      }

      setState(
        stateForPayment(await paymentsApi.capture(paymentId, { orderId })),
      );
    } catch (error) {
      const reason = conflictReason(error);

      if (reason === "stale_order") {
        setState({ kind: "superseded" });
        return;
      }

      if (reason === "reconciliation_required") {
        setState({ kind: "reconciliation" });
        return;
      }

      setState({
        kind: "error",
        message: getApiErrorMessage(error, {
          action: cancelled ? "update your checkout" : "confirm your payment",
          fallback: cancelled
            ? "We couldn't update your checkout. Please try again."
            : "We couldn't confirm your payment. Please try again.",
        }),
      });
    }
  }, [cancelled, orderId, paymentId]);

  useEffect(() => {
    const visit = `${paymentId}:${cancelled}:${orderId ?? ""}`;

    if (status !== "authenticated" || startedFor.current === visit) {
      return;
    }

    startedFor.current = visit;
    void confirm();
  }, [cancelled, confirm, orderId, paymentId, status]);

  if (status === "anonymous") {
    return null;
  }

  const backToBookings = (
    <Link href="/bookings" className={SECONDARY_OUTCOME_BUTTON_CLASS}>
      Back to bookings
    </Link>
  );

  const checkoutLink = (payment: PaymentRecord, label: string) => (
    <Link
      href={checkoutPath(payment.booking.id)}
      className={theme.marketplace.primaryButton}
    >
      {label}
    </Link>
  );

  if (status === "loading" || state.kind === "loading") {
    return (
      <PaymentOutcomePanel
        icon={<Loader2 className="h-10 w-10 animate-spin text-violet-500" />}
        title={cancelled ? "Checking your checkout" : "Confirming your payment"}
        description={
          cancelled
            ? "Hold tight while we check your checkout with PayPal."
            : "Hold tight while we confirm your payment with PayPal."
        }
      />
    );
  }

  switch (state.kind) {
    case "succeeded":
      return (
        <PaymentOutcomePanel
          icon={<CheckCircle2 className="h-10 w-10 text-emerald-500" />}
          title="Payment confirmed"
          description={`We received ${formatMoney(state.payment.totalAmount, state.payment.pricingCurrency)} for your stay on ${formatDateRange(state.payment.booking.startAt, state.payment.booking.endAt)}.`}
        >
          <Link href="/bookings" className={theme.marketplace.primaryButton}>
            View bookings
          </Link>
        </PaymentOutcomePanel>
      );
    case "pending":
      return (
        <PaymentOutcomePanel
          icon={<Clock className="h-10 w-10 text-sky-500" />}
          title="Payment still processing"
          description="PayPal hasn't finished processing this payment yet. This can take a few minutes."
        >
          <button
            type="button"
            onClick={() => void confirm()}
            className={theme.marketplace.primaryButton}
          >
            Check again
          </button>
          {backToBookings}
        </PaymentOutcomePanel>
      );
    case "failed":
      return (
        <PaymentOutcomePanel
          icon={<AlertTriangle className="h-10 w-10 text-rose-500" />}
          title="Payment didn't go through"
          description={declineMessage(state.payment)}
        >
          {checkoutLink(state.payment, "Try again")}
          {backToBookings}
        </PaymentOutcomePanel>
      );
    case "cancelled":
      return (
        <PaymentOutcomePanel
          icon={<AlertTriangle className="h-10 w-10 text-amber-500" />}
          title="Payment cancelled"
          description="You left PayPal before approving the payment, so nothing was charged. You can restart checkout while your booking hold is still active."
        >
          {checkoutLink(state.payment, "Restart checkout")}
          {backToBookings}
        </PaymentOutcomePanel>
      );
    case "superseded":
      return (
        <PaymentOutcomePanel
          icon={<AlertTriangle className="h-10 w-10 text-amber-500" />}
          title="This checkout was replaced"
          description="You started a newer checkout for this booking, so this PayPal order was not charged. Finish paying from your bookings."
        >
          {backToBookings}
        </PaymentOutcomePanel>
      );
    case "reconciliation":
      return (
        <PaymentOutcomePanel
          icon={<AlertTriangle className="h-10 w-10 text-amber-500" />}
          title="Payment received, booking under review"
          description="Your payment went through, but the booking needs to be reconciled before it can be confirmed. We'll follow up once it's resolved."
        >
          {backToBookings}
        </PaymentOutcomePanel>
      );
    case "error":
      return (
        <PaymentOutcomePanel
          icon={<AlertTriangle className="h-10 w-10 text-rose-500" />}
          title={
            cancelled
              ? "We couldn't update your checkout"
              : "We couldn't confirm your payment"
          }
          description={state.message}
        >
          <button
            type="button"
            onClick={() => void confirm()}
            className={theme.marketplace.primaryButton}
          >
            Try again
          </button>
          {backToBookings}
        </PaymentOutcomePanel>
      );
  }
}
