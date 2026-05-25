import { containerTokens } from "@/configuration/bootstrap/container";
import type { PaymentsController } from "@/features/payments/payments.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const paymentsRouteModule: RouteModule = {
  id: "payments",
  register(app, { resolveHandler }) {
    app.post(
      "/booking-requests/:id/payment-session",
      resolveHandler<PaymentsController>(
        containerTokens.paymentsController,
        "createSessionForBooking",
      ),
    );
    app.post(
      "/payments/webhooks/square",
      resolveHandler<PaymentsController>(
        containerTokens.paymentsController,
        "webhook",
      ),
    );
    app.get(
      "/payments/:id",
      resolveHandler<PaymentsController>(
        containerTokens.paymentsController,
        "getById",
      ),
    );
    app.post(
      "/payments/:id/retry",
      resolveHandler<PaymentsController>(
        containerTokens.paymentsController,
        "retry",
      ),
    );
    app.post(
      "/payments/:id/refunds",
      resolveHandler<PaymentsController>(
        containerTokens.paymentsController,
        "createRefund",
      ),
    );
    app.post(
      "/payments/:id/reconcile",
      resolveHandler<PaymentsController>(
        containerTokens.paymentsController,
        "reconcile",
      ),
    );
    app.post(
      "/payments/:id/repair",
      resolveHandler<PaymentsController>(
        containerTokens.paymentsController,
        "repair",
      ),
    );
    app.get(
      "/payouts/me",
      resolveHandler<PaymentsController>(
        containerTokens.paymentsController,
        "listPayouts",
      ),
    );
  },
};
