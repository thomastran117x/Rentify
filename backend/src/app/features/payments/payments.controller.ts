import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import { resolveIdempotencyKey } from "@/configuration/middlewares/idempotency.middleware";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import { requireMinimumRole } from "@/features/auth/authorization";
import type {
  CreatePaymentSessionBody,
  CreateRefundBody,
  ListPayoutsInput,
  ListPayoutsQuery,
  RetryPaymentBody,
} from "@/features/payments/payments.model";
import {
  createPaymentSessionSchema,
  createRefundSchema,
  listPayoutsQuerySchema,
  retryPaymentSchema,
} from "@/features/payments/payments.model";
import type { PaymentsService } from "@/features/payments/payments.service";

export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  createSessionForBooking = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, createPaymentSessionSchema);
    const result = await this.paymentsService.createPaymentSession({
      bookingRequestId: this.requireBookingRequestId(context),
      renterId: auth.sub,
      idempotencyKey: resolveIdempotencyKey(context, body.idempotencyKey),
    });
    return created(context, result, {
      message: "Payment session created successfully.",
    });
  };

  getById = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.paymentsService.getPaymentById(
      this.requirePaymentId(context),
      auth.sub,
    );
    return ok(context, result);
  };

  retry = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, retryPaymentSchema);
    const result = await this.paymentsService.retryPayment({
      paymentId: this.requirePaymentId(context),
      renterId: auth.sub,
      idempotencyKey: resolveIdempotencyKey(context, body.idempotencyKey),
    });
    return ok(context, result, {
      message: "Payment retry requested successfully.",
    });
  };

  createRefund = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, createRefundSchema);
    const result = await this.paymentsService.createRefund({
      paymentId: this.requirePaymentId(context),
      actorUserId: auth.sub,
      amount: body.amount,
      reason: body.reason ?? null,
      idempotencyKey: resolveIdempotencyKey(context, body.idempotencyKey),
    });
    return created(context, result, {
      message: "Refund created successfully.",
    });
  };

  listPayouts = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.paymentsService.listPayouts(
      this.toListPayoutsInput(auth.sub, this.parseListPayoutsQuery(context)),
    );
    return ok(context, result, {
      meta: paginationMeta(result),
    });
  };

  webhook = async (context: Context<AppBindings>): Promise<Response> => {
    const rawBody = await context.req.text();
    const signatureHeader = context.req.header("x-square-hmacsha256-signature");
    await this.paymentsService.processSquareWebhook(rawBody, signatureHeader);
    return ok(
      context,
      { ok: true },
      {
        message: "Payment webhook processed successfully.",
      },
    );
  };

  reconcile = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.paymentsService.reconcilePayment(
      this.requirePaymentId(context),
      auth.sub,
    );
    return ok(context, result, {
      message: "Payment reconciled successfully.",
    });
  };

  repair = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    requireMinimumRole(auth, "admin");
    await this.paymentsService.repairPayment(this.requirePaymentId(context));
    return ok(
      context,
      { ok: true },
      {
        message: "Payment repair queued successfully.",
      },
    );
  };

  private parseListPayoutsQuery(
    context: Context<AppBindings>,
  ): ListPayoutsQuery {
    const url = new URL(context.req.url);

    try {
      return listPayoutsQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      });
    } catch (error) {
      if ("issues" in (error as object)) {
        const issues = (
          error as { issues?: Array<{ path: PropertyKey[]; message: string }> }
        ).issues;

        throw new RequestValidationError(
          "Request query validation failed.",
          (issues ?? []).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }

      throw error;
    }
  }

  private toListPayoutsInput(
    userId: string,
    query: ListPayoutsQuery,
  ): ListPayoutsInput {
    return {
      actorUserId: userId,
      organizationId: "",
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    };
  }

  private requireBookingRequestId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "id");
  }

  private requirePaymentId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "id");
  }

  private async requireAuth(context: Context<AppBindings>) {
    return requireJwtAuth(context);
  }
}
