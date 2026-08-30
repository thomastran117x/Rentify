import type {
  ProviderErrorInfo,
  ProviderPaymentSession,
  ProviderPaymentStatus,
  ProviderRefundResult,
  SquareWebhookVerificationResult,
} from "@/features/payments/payments.model";
import type { Uuid } from "@/configuration/validation/uuid";

export interface PaymentProviderAdapter {
  createPaymentSession(input: {
    idempotencyKey: string;
    amount: number;
    currency: string;
    bookingRequestId: Uuid;
    paymentId: Uuid;
  }): Promise<ProviderPaymentSession>;
  getPaymentStatus(input: {
    providerPaymentId?: string;
    providerOrderId?: string;
  }): Promise<ProviderPaymentStatus | null>;
  createRefund(input: {
    idempotencyKey: string;
    providerPaymentId: string;
    amount: number;
    currency: string;
    reason?: string | null;
  }): Promise<ProviderRefundResult>;
  verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string | undefined,
  ): SquareWebhookVerificationResult;
  classifyError(error: unknown): ProviderErrorInfo;
}
