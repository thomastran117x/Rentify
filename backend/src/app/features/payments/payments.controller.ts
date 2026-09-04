import type { Request, Response } from "express";
import { getRequestUrl, readRawBody } from "@/configuration/http/request";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import { resolveIdempotencyKey } from "@/configuration/middlewares/idempotency.middleware";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import { requireUuidRouteParam } from "@/configuration/validation/input-sanitization";
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
import { asUuid, type Uuid } from "@/configuration/validation/uuid";

export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  createSessionForBooking = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, createPaymentSessionSchema);
    const result = await this.paymentsService.createPaymentSession({
      bookingRequestId: asUuid(this.requireBookingRequestId(request)),
      renterId: asUuid(auth.sub),
      idempotencyKey: resolveIdempotencyKey(request, body.idempotencyKey),
    });
    created(response, result, {
      message: "Payment session created successfully.",
    });
  };

  getById = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.paymentsService.getPaymentById(
      this.requirePaymentId(request),
      auth.sub,
    );
    ok(response, result);
  };

  getByBookingRequest = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.paymentsService.getPaymentByBookingRequest(
      this.requireBookingRequestId(request),
      auth.sub,
    );
    ok(response, result);
  };

  retry = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, retryPaymentSchema);
    const result = await this.paymentsService.retryPayment({
      paymentId: asUuid(this.requirePaymentId(request)),
      renterId: asUuid(auth.sub),
      idempotencyKey: resolveIdempotencyKey(request, body.idempotencyKey),
    });
    ok(response, result, {
      message: "Payment retry requested successfully.",
    });
  };

  createRefund = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, createRefundSchema);
    const result = await this.paymentsService.createRefund({
      paymentId: asUuid(this.requirePaymentId(request)),
      actorUserId: asUuid(auth.sub),
      amount: body.amount,
      reason: body.reason ?? null,
      idempotencyKey: resolveIdempotencyKey(request, body.idempotencyKey),
    });
    created(response, result, {
      message: "Refund created successfully.",
    });
  };

  listPayouts = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.paymentsService.listPayouts(
      this.toListPayoutsInput(auth.sub, this.parseListPayoutsQuery(request)),
    );
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  webhook = async (request: Request, response: Response): Promise<void> => {
    const rawBody = readRawBody(request);
    const signatureHeader = request.get("x-square-hmacsha256-signature");
    await this.paymentsService.processSquareWebhook(rawBody, signatureHeader);
    ok(
      response,
      { ok: true },
      {
        message: "Payment webhook processed successfully.",
      },
    );
  };

  reconcile = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.paymentsService.reconcilePayment(
      this.requirePaymentId(request),
      auth.sub,
    );
    ok(response, result, {
      message: "Payment reconciled successfully.",
    });
  };

  repair = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    requireMinimumRole(auth, "admin");
    await this.paymentsService.repairPayment(this.requirePaymentId(request));
    ok(
      response,
      { ok: true },
      {
        message: "Payment repair queued successfully.",
      },
    );
  };

  private parseListPayoutsQuery(request: Request): ListPayoutsQuery {
    const url = getRequestUrl(request);

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
    userId: Uuid,
    query: ListPayoutsQuery,
  ): ListPayoutsInput {
    return {
      actorUserId: asUuid(userId),
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    };
  }

  private requireBookingRequestId(request: Request): Uuid {
    return requireUuidRouteParam(request, "id");
  }

  private requirePaymentId(request: Request): Uuid {
    return requireUuidRouteParam(request, "id");
  }

  private async requireAuth(request: Request) {
    return requireJwtAuth(request);
  }
}
