import { ApiError } from "@/lib/api/types";
import type {
  CheckoutSummary,
  PaymentConflictReason,
  PaymentMethod,
  PaymentRecord,
} from "@/lib/payments/api";

export const CAPTURED_PAYMENT_STATUSES = new Set([
  "succeeded",
  "refunded",
  "partially_refunded",
]);
export const FAILED_PAYMENT_STATUSES = new Set([
  "failed_retryable",
  "failed_final",
  "cancelled",
]);

export interface CheckoutNotice {
  tone: "error" | "info";
  text: string;
}

/** Where the renter is in paying, once the summary has loaded. */
export type CheckoutFlow =
  | { kind: "idle"; notice?: CheckoutNotice }
  | { kind: "creating_order"; method: PaymentMethod }
  | {
      kind: "awaiting_approval";
      method: PaymentMethod;
      paymentId: string;
      orderId: string;
    }
  | { kind: "capturing" }
  | { kind: "succeeded"; payment: PaymentRecord }
  | { kind: "pending"; payment: PaymentRecord }
  | { kind: "superseded" }
  | { kind: "reconciliation" }
  | { kind: "hold_expired" };

export type CheckoutState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "loaded";
      summary: CheckoutSummary;
      /** Server clock minus browser clock, so the hold countdown is not skewed. */
      serverOffsetMs: number;
      flow: CheckoutFlow;
    };

export type CheckoutAction =
  | { type: "load_started" }
  | { type: "load_failed"; message: string }
  | { type: "summary_loaded"; summary: CheckoutSummary; receivedAt: number }
  | { type: "order_requested"; method: PaymentMethod }
  | {
      type: "order_created";
      method: PaymentMethod;
      paymentId: string;
      orderId: string;
    }
  | { type: "capture_started" }
  | { type: "payment_settled"; payment: PaymentRecord }
  | { type: "checkout_interrupted"; notice?: CheckoutNotice }
  | { type: "conflict"; reason: PaymentConflictReason }
  | { type: "hold_expired" };

export const initialCheckoutState: CheckoutState = { phase: "loading" };

const DECLINE_MESSAGES: Record<string, string> = {
  CARD_AUTHENTICATION_FAILED:
    "Your bank couldn't verify this card, so nothing was charged. Try again or use another payment method.",
  CARD_AUTHENTICATION_UNAVAILABLE:
    "Card verification is unavailable right now, so nothing was charged. Try again or use another payment method.",
  HOLD_EXPIRED:
    "Your booking hold expired before the payment was confirmed, so nothing was charged.",
  ORDER_MISMATCH:
    "Something changed with this checkout, so nothing was charged. Please try again.",
};

const GENERIC_DECLINE_MESSAGE =
  "The payment didn't go through and nothing was charged. Try again or use another payment method.";

/** Busy flows keep the payment buttons disabled. */
export function isCheckoutBusy(flow: CheckoutFlow): boolean {
  return (
    flow.kind === "creating_order" ||
    flow.kind === "awaiting_approval" ||
    flow.kind === "capturing"
  );
}

/** The reason the API attached to a checkout 409, if any. */
export function conflictReason(error: unknown): PaymentConflictReason | null {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return null;
  }

  const reason =
    typeof error.details === "object" && error.details !== null
      ? (error.details as { reason?: unknown }).reason
      : undefined;

  switch (reason) {
    case "payment_in_progress":
    case "checkout_busy":
    case "stale_order":
    case "reconciliation_required":
      return reason;
    default:
      return null;
  }
}

/** Copy for a payment the API ended without charging. */
export function declineMessage(payment: PaymentRecord): string {
  const attempt =
    payment.attempts.find(
      (item) =>
        item.providerOrderId !== undefined &&
        item.providerOrderId === payment.providerOrderId,
    ) ?? payment.attempts[0];
  const code = attempt?.failureCode;

  if (code && DECLINE_MESSAGES[code]) {
    return DECLINE_MESSAGES[code];
  }

  return attempt?.failureMessage ?? GENERIC_DECLINE_MESSAGE;
}

function flowAfterSummary(
  previous: CheckoutState,
  summary: CheckoutSummary,
): CheckoutFlow {
  if (previous.phase !== "loaded") {
    return { kind: "idle" };
  }

  // A background refresh must not interrupt a payment in progress.
  if (isCheckoutBusy(previous.flow)) {
    return previous.flow;
  }

  // Keep the outcome of a settled payment on screen until the renter leaves.
  if (
    previous.flow.kind === "succeeded" ||
    previous.flow.kind === "pending" ||
    previous.flow.kind === "reconciliation"
  ) {
    return previous.flow;
  }

  if (previous.flow.kind === "idle" && summary.checkout.eligible) {
    return previous.flow;
  }

  return { kind: "idle" };
}

function withFlow(state: CheckoutState, flow: CheckoutFlow): CheckoutState {
  return state.phase === "loaded" ? { ...state, flow } : state;
}

export function checkoutReducer(
  state: CheckoutState,
  action: CheckoutAction,
): CheckoutState {
  switch (action.type) {
    case "load_started":
      return state.phase === "loaded" ? state : { phase: "loading" };
    case "load_failed":
      return state.phase === "loaded"
        ? state
        : { phase: "error", message: action.message };
    case "summary_loaded":
      return {
        phase: "loaded",
        summary: action.summary,
        serverOffsetMs:
          Date.parse(action.summary.serverTime) - action.receivedAt,
        flow: flowAfterSummary(state, action.summary),
      };
    case "order_requested":
      return withFlow(state, {
        kind: "creating_order",
        method: action.method,
      });
    case "order_created":
      return withFlow(state, {
        kind: "awaiting_approval",
        method: action.method,
        paymentId: action.paymentId,
        orderId: action.orderId,
      });
    case "capture_started":
      return withFlow(state, { kind: "capturing" });
    case "payment_settled": {
      const { payment } = action;

      if (CAPTURED_PAYMENT_STATUSES.has(payment.status)) {
        return withFlow(state, { kind: "succeeded", payment });
      }

      if (FAILED_PAYMENT_STATUSES.has(payment.status)) {
        return withFlow(state, {
          kind: "idle",
          notice: { tone: "error", text: declineMessage(payment) },
        });
      }

      return withFlow(state, { kind: "pending", payment });
    }
    case "checkout_interrupted":
      return withFlow(state, { kind: "idle", notice: action.notice });
    case "conflict":
      switch (action.reason) {
        case "stale_order":
          return withFlow(state, { kind: "superseded" });
        case "reconciliation_required":
          return withFlow(state, { kind: "reconciliation" });
        default:
          return withFlow(state, {
            kind: "idle",
            notice: {
              tone: "info",
              text: "This checkout was updated in another window. Review the details and try again.",
            },
          });
      }
    case "hold_expired":
      // A capture already in flight is decided by the server's hold check.
      if (state.phase !== "loaded" || state.flow.kind === "capturing") {
        return state;
      }

      return withFlow(state, { kind: "hold_expired" });
  }
}
