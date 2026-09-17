import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import {
  buildCheckoutPayment as buildPayment,
  buildCheckoutSummary,
  buildPaymentAttempt as attempt,
} from "@/test/mocks/checkout";
import {
  checkoutReducer,
  conflictReason,
  declineMessage,
  initialCheckoutState,
  isCheckoutBusy,
  type CheckoutState,
} from "./state";

function loadedState(
  flow: Extract<CheckoutState, { phase: "loaded" }>["flow"] = { kind: "idle" },
): CheckoutState {
  return {
    phase: "loaded",
    summary: buildCheckoutSummary(),
    serverOffsetMs: 0,
    flow,
  };
}

function conflict(details: unknown, status = 409) {
  return new ApiClientError("Conflict", {
    status,
    code: "CONFLICT",
    details,
    request: { method: "POST", path: "/x", requestUrl: "/x" },
  });
}

describe("checkoutReducer", () => {
  it("loads the summary and records the server clock offset", () => {
    const loading = checkoutReducer(initialCheckoutState, {
      type: "load_started",
    });
    expect(loading).toEqual({ phase: "loading" });

    const loaded = checkoutReducer(loading, {
      type: "summary_loaded",
      summary: buildCheckoutSummary(),
      receivedAt: Date.parse("2026-09-17T11:59:58.000Z"),
    });

    expect(loaded).toMatchObject({
      phase: "loaded",
      serverOffsetMs: 2000,
      flow: { kind: "idle" },
    });
  });

  it("reports load failures only before a summary is on screen", () => {
    expect(
      checkoutReducer(initialCheckoutState, {
        type: "load_failed",
        message: "Boom",
      }),
    ).toEqual({ phase: "error", message: "Boom" });

    const loaded = loadedState();
    expect(
      checkoutReducer(loaded, { type: "load_failed", message: "Boom" }),
    ).toBe(loaded);
    expect(checkoutReducer(loaded, { type: "load_started" })).toBe(loaded);
  });

  it("walks an order from creation through capture", () => {
    let state = checkoutReducer(loadedState(), {
      type: "order_requested",
      method: "card",
    });
    expect(state).toMatchObject({
      flow: { kind: "creating_order", method: "card" },
    });

    state = checkoutReducer(state, {
      type: "order_created",
      method: "card",
      paymentId: "payment-1",
      orderId: "ORDER-2",
    });
    expect(state).toMatchObject({
      flow: { kind: "awaiting_approval", orderId: "ORDER-2" },
    });

    state = checkoutReducer(state, { type: "capture_started" });
    expect(state).toMatchObject({ flow: { kind: "capturing" } });

    state = checkoutReducer(state, {
      type: "payment_settled",
      payment: buildPayment(),
    });
    expect(state).toMatchObject({ flow: { kind: "succeeded" } });
  });

  it("returns declined payments to idle with a decline notice", () => {
    const state = checkoutReducer(loadedState({ kind: "capturing" }), {
      type: "payment_settled",
      payment: buildPayment({
        status: "failed_final",
        attempts: [
          attempt({
            providerOrderId: "ORDER-2",
            failureCode: "CARD_AUTHENTICATION_FAILED",
          }),
        ],
      }),
    });

    expect(state).toMatchObject({
      flow: {
        kind: "idle",
        notice: {
          tone: "error",
          text: expect.stringContaining("couldn't verify this card"),
        },
      },
    });
  });

  it("keeps waiting on payments that are still processing", () => {
    expect(
      checkoutReducer(loadedState({ kind: "capturing" }), {
        type: "payment_settled",
        payment: buildPayment({ status: "processing" }),
      }),
    ).toMatchObject({ flow: { kind: "pending" } });
  });

  it("maps checkout conflicts", () => {
    expect(
      checkoutReducer(loadedState({ kind: "capturing" }), {
        type: "conflict",
        reason: "stale_order",
      }),
    ).toMatchObject({ flow: { kind: "superseded" } });
    expect(
      checkoutReducer(loadedState({ kind: "capturing" }), {
        type: "conflict",
        reason: "reconciliation_required",
      }),
    ).toMatchObject({ flow: { kind: "reconciliation" } });
    expect(
      checkoutReducer(
        loadedState({ kind: "creating_order", method: "paypal" }),
        {
          type: "conflict",
          reason: "payment_in_progress",
        },
      ),
    ).toMatchObject({ flow: { kind: "idle", notice: { tone: "info" } } });
  });

  it("interrupts a checkout with an optional notice", () => {
    expect(
      checkoutReducer(
        loadedState({ kind: "creating_order", method: "paypal" }),
        {
          type: "checkout_interrupted",
          notice: { tone: "info", text: "Cancelled" },
        },
      ),
    ).toMatchObject({ flow: { kind: "idle", notice: { text: "Cancelled" } } });
  });

  it("expires the hold unless a capture is already in flight", () => {
    expect(
      checkoutReducer(loadedState(), { type: "hold_expired" }),
    ).toMatchObject({ flow: { kind: "hold_expired" } });

    const capturing = loadedState({ kind: "capturing" });
    expect(checkoutReducer(capturing, { type: "hold_expired" })).toBe(
      capturing,
    );
    expect(
      checkoutReducer(initialCheckoutState, { type: "hold_expired" }),
    ).toBe(initialCheckoutState);
  });

  it("ignores flow actions before the summary loads", () => {
    expect(
      checkoutReducer(initialCheckoutState, { type: "capture_started" }),
    ).toBe(initialCheckoutState);
  });

  it("keeps busy and settled flows across a background refresh", () => {
    const refreshed = (
      flow: Extract<CheckoutState, { phase: "loaded" }>["flow"],
      summary = buildCheckoutSummary(),
    ) =>
      checkoutReducer(loadedState(flow), {
        type: "summary_loaded",
        summary,
        receivedAt: Date.parse(summary.serverTime),
      });
    const ineligible = buildCheckoutSummary({
      checkout: { eligible: false, reason: "already_paid" },
    });

    expect(refreshed({ kind: "capturing" })).toMatchObject({
      flow: { kind: "capturing" },
    });
    expect(
      refreshed({ kind: "succeeded", payment: buildPayment() }, ineligible),
    ).toMatchObject({ flow: { kind: "succeeded" } });
    expect(
      refreshed({ kind: "idle", notice: { tone: "info", text: "Kept" } }),
    ).toMatchObject({ flow: { notice: { text: "Kept" } } });
    expect(
      refreshed(
        { kind: "idle", notice: { tone: "info", text: "Dropped" } },
        ineligible,
      ),
    ).toMatchObject({ flow: { kind: "idle" } });
    expect(
      refreshed(
        { kind: "idle", notice: { tone: "info", text: "Dropped" } },
        ineligible,
      ),
    ).not.toMatchObject({ flow: { notice: { text: "Dropped" } } });
    expect(refreshed({ kind: "hold_expired" })).toMatchObject({
      flow: { kind: "idle" },
    });
  });
});

describe("isCheckoutBusy", () => {
  it("treats order creation, approval, and capture as busy", () => {
    expect(isCheckoutBusy({ kind: "creating_order", method: "paypal" })).toBe(
      true,
    );
    expect(
      isCheckoutBusy({
        kind: "awaiting_approval",
        method: "paypal",
        paymentId: "p",
        orderId: "o",
      }),
    ).toBe(true);
    expect(isCheckoutBusy({ kind: "capturing" })).toBe(true);
    expect(isCheckoutBusy({ kind: "idle" })).toBe(false);
  });
});

describe("conflictReason", () => {
  it("reads known reasons from 409 responses only", () => {
    expect(conflictReason(conflict({ reason: "stale_order" }))).toBe(
      "stale_order",
    );
    expect(conflictReason(conflict({ reason: "checkout_busy" }))).toBe(
      "checkout_busy",
    );
    expect(conflictReason(conflict({ reason: "payment_in_progress" }))).toBe(
      "payment_in_progress",
    );
    expect(
      conflictReason(conflict({ reason: "reconciliation_required" })),
    ).toBe("reconciliation_required");
    expect(conflictReason(conflict({ reason: "mystery" }))).toBeNull();
    expect(conflictReason(conflict(undefined))).toBeNull();
    expect(conflictReason(conflict({ reason: "stale_order" }, 400))).toBeNull();
    expect(conflictReason(new Error("nope"))).toBeNull();
  });
});

describe("declineMessage", () => {
  it("prefers the attempt for the current order and known failure codes", () => {
    expect(
      declineMessage(
        buildPayment({
          attempts: [
            attempt({ providerOrderId: "ORDER-3", failureMessage: "Other" }),
            attempt({
              providerOrderId: "ORDER-2",
              failureCode: "HOLD_EXPIRED",
            }),
          ],
        }),
      ),
    ).toContain("hold expired");
  });

  it("falls back to the attempt message, then a generic message", () => {
    expect(
      declineMessage(
        buildPayment({
          providerOrderId: undefined,
          attempts: [attempt({ failureMessage: "Card declined." })],
        }),
      ),
    ).toBe("Card declined.");
    expect(declineMessage(buildPayment())).toContain("didn't go through");
  });
});
