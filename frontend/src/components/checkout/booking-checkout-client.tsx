"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import {
  CheckoutCancellationPolicy,
  CheckoutHoldCountdown,
  CheckoutOrderSummary,
} from "@/components/checkout/checkout-summary";
import {
  PayPalPaymentMethods,
  type CheckoutPaymentHandlers,
} from "@/components/checkout/paypal-payment-methods";
import {
  PaymentOutcomePanel,
  SECONDARY_OUTCOME_BUTTON_CLASS,
} from "@/components/payments/payment-outcome";
import { ApiError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { resolvePayPalSdkConfig } from "@/lib/checkout/paypal-config";
import {
  FAILED_PAYMENT_STATUSES,
  checkoutReducer,
  conflictReason,
  declineMessage,
  initialCheckoutState,
  isCheckoutBusy,
  type CheckoutFlow,
} from "@/lib/checkout/state";
import {
  paymentsApi,
  type CheckoutPaymentMethod,
  type CheckoutSummary,
  type PaymentMethod,
  type PaymentRecord,
} from "@/lib/payments/api";
import { formatDateRange, formatMoney } from "@/lib/rentings/format";
import { theme } from "@/styles/theme";

const CHECKOUT_BUSY_RETRY_DELAY_MS = 1_000;
const CHECKOUT_START_FALLBACK =
  "We couldn't start checkout right now. Please try again.";

interface BookingCheckoutClientProps {
  bookingRequestId: string;
}

class CheckoutStartError extends Error {}

function createIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function BookingCheckoutClient({
  bookingRequestId,
}: BookingCheckoutClientProps) {
  const router = useRouter();
  const { status } = useAuth();
  const [state, dispatch] = useReducer(checkoutReducer, initialCheckoutState);
  const [sdkUnavailable, setSdkUnavailable] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const bookingPath = `/bookings/${encodeURIComponent(bookingRequestId)}`;
  // SDK callbacks outlive renders, so they read the latest flow and order from
  // refs instead of closing over stale state.
  const flowRef = useRef<CheckoutFlow | null>(null);
  const paymentIdRef = useRef<string | null>(null);
  const currentFlow = state.phase === "loaded" ? state.flow : null;

  useEffect(() => {
    flowRef.current = currentFlow;
  }, [currentFlow]);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [router, status]);

  const loadSummary = useCallback(async () => {
    dispatch({ type: "load_started" });

    try {
      const summary = await paymentsApi.getCheckoutSummary(bookingRequestId);
      dispatch({ type: "summary_loaded", summary, receivedAt: Date.now() });
    } catch (error) {
      // Only the renter can check out; everyone else goes back to the booking.
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        router.replace(bookingPath);
        return;
      }

      dispatch({
        type: "load_failed",
        message: getApiErrorMessage(error, {
          action: "load checkout",
          fallback: "We couldn't load checkout for this booking.",
        }),
      });
    }
  }, [bookingPath, bookingRequestId, router]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    void loadSummary();
  }, [loadSummary, status]);

  // Coming back to the tab (for example after a PayPal popup or another
  // window) refreshes the hold and payment state.
  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadSummary();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [loadSummary, status]);

  const summary = state.phase === "loaded" ? state.summary : null;
  const ineligibleReason =
    summary && !summary.checkout.eligible ? summary.checkout.reason : undefined;

  useEffect(() => {
    if (
      ineligibleReason === "converted" ||
      ineligibleReason === "not_payable"
    ) {
      router.replace(bookingPath);
    }
  }, [bookingPath, ineligibleReason, router]);

  const handleConflict = useCallback(
    async (error: unknown): Promise<boolean> => {
      const reason = conflictReason(error);

      if (!reason) {
        return false;
      }

      dispatch({ type: "conflict", reason });

      if (reason === "payment_in_progress") {
        await loadSummary();
      }

      return true;
    },
    [loadSummary],
  );

  const createSession = useCallback(
    async (method: PaymentMethod): Promise<PaymentRecord> => {
      const request = () =>
        paymentsApi.createSession(bookingRequestId, {
          method,
          idempotencyKey: createIdempotencyKey(),
        });

      try {
        return await request();
      } catch (error) {
        // Another request briefly held the booking; one retry is enough.
        if (conflictReason(error) === "checkout_busy") {
          await wait(CHECKOUT_BUSY_RETRY_DELAY_MS);
          return request();
        }

        throw error;
      }
    },
    [bookingRequestId],
  );

  const createOrder = useCallback(
    async (method: CheckoutPaymentMethod): Promise<{ orderId: string }> => {
      dispatch({ type: "order_requested", method });

      try {
        const payment = await createSession(method);

        if (
          FAILED_PAYMENT_STATUSES.has(payment.status) ||
          !payment.providerOrderId
        ) {
          dispatch({
            type: "checkout_interrupted",
            notice: {
              tone: "error",
              text: FAILED_PAYMENT_STATUSES.has(payment.status)
                ? declineMessage(payment)
                : CHECKOUT_START_FALLBACK,
            },
          });
          throw new CheckoutStartError(CHECKOUT_START_FALLBACK);
        }

        paymentIdRef.current = payment.id;
        dispatch({
          type: "order_created",
          method,
          paymentId: payment.id,
          orderId: payment.providerOrderId,
        });
        return { orderId: payment.providerOrderId };
      } catch (error) {
        if (error instanceof CheckoutStartError) {
          throw error;
        }

        if (!(await handleConflict(error))) {
          dispatch({
            type: "checkout_interrupted",
            notice: {
              tone: "error",
              text: getApiErrorMessage(error, {
                action: "start checkout",
                fallback: CHECKOUT_START_FALLBACK,
                preserveClientMessage: true,
              }),
            },
          });
        }

        throw new CheckoutStartError(CHECKOUT_START_FALLBACK);
      }
    },
    [createSession, handleConflict],
  );

  const approve = useCallback(
    async (orderId: string) => {
      const paymentId = paymentIdRef.current;

      if (!paymentId) {
        return;
      }

      dispatch({ type: "capture_started" });

      try {
        const payment = await paymentsApi.capture(paymentId, { orderId });
        dispatch({ type: "payment_settled", payment });
      } catch (error) {
        if (await handleConflict(error)) {
          return;
        }

        dispatch({
          type: "checkout_interrupted",
          notice: {
            tone: "error",
            text: getApiErrorMessage(error, {
              action: "confirm your payment",
              fallback:
                "We couldn't confirm your payment. If you were charged, it will appear on your booking shortly.",
            }),
          },
        });
      }
    },
    [handleConflict],
  );

  const cancel = useCallback(() => {
    if (!flowRef.current || !isCheckoutBusy(flowRef.current)) {
      return;
    }

    dispatch({
      type: "checkout_interrupted",
      notice: {
        tone: "info",
        text: "Checkout was cancelled and nothing was charged. Pick a payment method to try again.",
      },
    });
  }, []);

  const fail = useCallback((error: unknown) => {
    // Order creation failures already explained themselves.
    if (
      error instanceof CheckoutStartError ||
      !flowRef.current ||
      !isCheckoutBusy(flowRef.current)
    ) {
      return;
    }

    dispatch({
      type: "checkout_interrupted",
      notice: {
        tone: "error",
        text:
          error instanceof Error && error.message
            ? `The payment didn't go through: ${error.message}`
            : "The payment didn't go through and nothing was charged. Please try again.",
      },
    });
  }, []);

  const handlers = useMemo<CheckoutPaymentHandlers>(
    () => ({ createOrder, approve, cancel, fail }),
    [approve, cancel, createOrder, fail],
  );

  const handleSdkUnavailable = useCallback(() => setSdkUnavailable(true), []);

  const handleHoldExpired = useCallback(() => {
    dispatch({ type: "hold_expired" });
    void loadSummary();
  }, [loadSummary]);

  async function payWithRedirect() {
    setRedirecting(true);
    dispatch({ type: "order_requested", method: "paypal_redirect" });

    try {
      const payment = await createSession("paypal_redirect");

      if (payment.checkoutUrl) {
        window.location.assign(payment.checkoutUrl);
        return;
      }

      dispatch({
        type: "checkout_interrupted",
        notice: {
          tone: "error",
          text: FAILED_PAYMENT_STATUSES.has(payment.status)
            ? declineMessage(payment)
            : CHECKOUT_START_FALLBACK,
        },
      });
    } catch (error) {
      if (!(await handleConflict(error))) {
        dispatch({
          type: "checkout_interrupted",
          notice: {
            tone: "error",
            text: getApiErrorMessage(error, {
              action: "start checkout",
              fallback: CHECKOUT_START_FALLBACK,
              preserveClientMessage: true,
            }),
          },
        });
      }
    }

    setRedirecting(false);
  }

  async function checkPaymentAgain(paymentId: string) {
    try {
      dispatch({
        type: "payment_settled",
        payment: await paymentsApi.getById(paymentId),
      });
    } catch (error) {
      dispatch({
        type: "checkout_interrupted",
        notice: {
          tone: "error",
          text: getApiErrorMessage(error, {
            action: "check your payment",
            fallback: "We couldn't check your payment. Please try again.",
          }),
        },
      });
    }
  }

  if (status === "anonymous") {
    return null;
  }

  const bookingLink = (label: string, primary = false) => (
    <Link
      href={bookingPath}
      className={
        primary
          ? theme.marketplace.primaryButton
          : SECONDARY_OUTCOME_BUTTON_CLASS
      }
    >
      {label}
    </Link>
  );

  if (status === "loading" || state.phase === "loading") {
    return (
      <CheckoutShell bookingPath={bookingPath}>
        <PaymentOutcomePanel
          embedded
          icon={<Loader2 className="h-10 w-10 animate-spin text-violet-500" />}
          title="Loading checkout"
          description="Getting your booking and price details."
        />
      </CheckoutShell>
    );
  }

  if (state.phase === "error") {
    return (
      <CheckoutShell bookingPath={bookingPath}>
        <PaymentOutcomePanel
          embedded
          icon={<AlertTriangle className="h-10 w-10 text-rose-500" />}
          title="We couldn't load checkout"
          description={state.message}
        >
          <button
            type="button"
            onClick={() => void loadSummary()}
            className={theme.marketplace.primaryButton}
          >
            Try again
          </button>
          {bookingLink("Back to booking")}
        </PaymentOutcomePanel>
      </CheckoutShell>
    );
  }

  const loaded = state;
  const { flow } = loaded;
  const currentSummary: CheckoutSummary = loaded.summary;

  const outcome = (() => {
    switch (flow.kind) {
      case "succeeded":
        return (
          <PaymentOutcomePanel
            embedded
            icon={<CheckCircle2 className="h-10 w-10 text-emerald-500" />}
            title="Payment confirmed"
            description={`We received ${formatMoney(flow.payment.totalAmount, flow.payment.pricingCurrency)} for your stay on ${formatDateRange(flow.payment.booking.startAt, flow.payment.booking.endAt)}.`}
          >
            {bookingLink("View booking", true)}
          </PaymentOutcomePanel>
        );
      case "pending":
        return (
          <PaymentOutcomePanel
            embedded
            icon={<Clock className="h-10 w-10 text-sky-500" />}
            title="Payment still processing"
            description="PayPal hasn't finished processing this payment yet. This can take a few minutes."
          >
            <button
              type="button"
              onClick={() => void checkPaymentAgain(flow.payment.id)}
              className={theme.marketplace.primaryButton}
            >
              Check again
            </button>
            {bookingLink("Back to booking")}
          </PaymentOutcomePanel>
        );
      case "superseded":
        return (
          <PaymentOutcomePanel
            embedded
            icon={<AlertTriangle className="h-10 w-10 text-amber-500" />}
            title="Checkout restarted elsewhere"
            description="A newer checkout for this booking was started in another window, so this payment was not charged."
          >
            <button
              type="button"
              onClick={() => void loadSummary()}
              className={theme.marketplace.primaryButton}
            >
              Reload checkout
            </button>
            {bookingLink("Back to booking")}
          </PaymentOutcomePanel>
        );
      case "reconciliation":
        return (
          <PaymentOutcomePanel
            embedded
            icon={<AlertTriangle className="h-10 w-10 text-amber-500" />}
            title="Payment received, booking under review"
            description="Your payment went through, but the booking needs to be reconciled before it can be confirmed. We'll follow up once it's resolved."
          >
            {bookingLink("Back to booking")}
          </PaymentOutcomePanel>
        );
      default:
        break;
    }

    switch (ineligibleReason) {
      case "already_paid":
        return (
          <PaymentOutcomePanel
            embedded
            icon={<CheckCircle2 className="h-10 w-10 text-emerald-500" />}
            title="This booking is already paid"
            description="There's nothing left to pay here."
          >
            {bookingLink("View booking", true)}
          </PaymentOutcomePanel>
        );
      case "reconciliation":
        return (
          <PaymentOutcomePanel
            embedded
            icon={<AlertTriangle className="h-10 w-10 text-amber-500" />}
            title="Payment received, booking under review"
            description="A payment for this booking needs to be reconciled before anything else can happen. We'll follow up once it's resolved."
          >
            {bookingLink("Back to booking")}
          </PaymentOutcomePanel>
        );
      case "hold_expired":
        return (
          <PaymentOutcomePanel
            embedded
            icon={<Clock className="h-10 w-10 text-rose-500" />}
            title="Your booking hold has expired"
            description="The time to pay for this booking ran out, so it can no longer be paid. Nothing was charged."
          >
            {bookingLink("Back to booking")}
          </PaymentOutcomePanel>
        );
      case "converted":
      case "not_payable":
        return (
          <PaymentOutcomePanel
            embedded
            icon={
              <Loader2 className="h-10 w-10 animate-spin text-violet-500" />
            }
            title="Returning to your booking"
            description="This booking can't be paid from checkout."
          />
        );
      default:
        return null;
    }
  })();

  if (outcome) {
    return <CheckoutShell bookingPath={bookingPath}>{outcome}</CheckoutShell>;
  }

  const sdkConfig = sdkUnavailable
    ? null
    : resolvePayPalSdkConfig(currentSummary);
  const busy = isCheckoutBusy(flow) || redirecting;
  const holdExpired = flow.kind === "hold_expired";
  const notice = flow.kind === "idle" ? flow.notice : undefined;

  const totalDueNow = formatMoney(
    currentSummary.pricing.totalDueNow,
    currentSummary.pricing.currency,
  );

  return (
    <CheckoutShell bookingPath={bookingPath}>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section
          aria-labelledby="payment-heading"
          className="order-last grid content-start gap-4 lg:order-first"
        >
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
              <h2
                id="payment-heading"
                className="text-sm font-semibold text-slate-950 dark:text-white"
              >
                Payment
              </h2>
              <CheckoutHoldCountdown
                holdExpiresAt={currentSummary.booking.holdExpiresAt}
                serverOffsetMs={loaded.serverOffsetMs}
                onExpire={handleHoldExpired}
              />
            </div>

            <div className="px-5 py-5">
              {notice ? (
                <div
                  role={notice.tone === "error" ? "alert" : "status"}
                  className={`mb-4 ${notice.tone === "error" ? theme.auth.errorPanel : theme.auth.infoPanel}`}
                >
                  {notice.text}
                </div>
              ) : null}

              {holdExpired ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Checking your booking hold...
                </p>
              ) : (
                <div className="relative">
                  {flow.kind === "capturing" ? (
                    <div
                      role="status"
                      className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl bg-white/85 text-sm font-semibold text-slate-900 backdrop-blur-sm dark:bg-slate-900/85 dark:text-white"
                    >
                      <Loader2
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin"
                      />
                      Confirming payment...
                    </div>
                  ) : null}
                  <div
                    inert={flow.kind === "capturing" || redirecting}
                    className="grid gap-4"
                  >
                    {sdkConfig ? (
                      <PayPalPaymentMethods
                        config={sdkConfig}
                        summary={currentSummary}
                        handlers={handlers}
                        disabled={busy}
                        onUnavailable={handleSdkUnavailable}
                      />
                    ) : (
                      <>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                          {sdkUnavailable
                            ? "Payment options couldn't load on this page. You can still pay securely on PayPal."
                            : "You'll finish paying securely on PayPal and come back here when you're done."}
                        </p>
                        <button
                          type="button"
                          onClick={() => void payWithRedirect()}
                          disabled={busy}
                          className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-[#ffc439] px-4 text-sm font-semibold text-[#003087] transition hover:bg-[#f0b32f] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {redirecting
                            ? "Opening PayPal..."
                            : `Continue to PayPal · ${totalDueNow}`}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            Payments are processed by PayPal. Rentify never sees your card
            details.
            {sdkConfig ? (
              <button
                type="button"
                onClick={() => void payWithRedirect()}
                disabled={busy}
                className="inline-flex items-center gap-1 font-semibold text-slate-600 underline-offset-4 transition hover:text-violet-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300"
              >
                Pay on PayPal.com
                <ExternalLink aria-hidden="true" className="h-3 w-3" />
              </button>
            ) : null}
          </p>
        </section>

        <aside className="order-first grid content-start gap-4 lg:sticky lg:top-24 lg:order-last">
          <CheckoutOrderSummary summary={currentSummary} />
          <CheckoutCancellationPolicy summary={currentSummary} />
        </aside>
      </div>
    </CheckoutShell>
  );
}

function CheckoutShell({
  bookingPath,
  children,
}: {
  bookingPath: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href={bookingPath}
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-violet-700 dark:text-slate-300"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to booking
      </Link>
      <div className="mt-6">{children}</div>
    </div>
  );
}
