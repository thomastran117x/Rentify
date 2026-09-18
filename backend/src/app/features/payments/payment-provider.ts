import type {
  PaymentWebhookHeaders,
  PaymentWebhookVerificationResult,
  ProviderErrorInfo,
  ProviderPaymentSession,
  ProviderPaymentSessionRequest,
  ProviderPaymentStatus,
  ProviderRefundResult,
} from "@/features/payments/payments.model";

export interface PaymentProviderAdapter {
  createPaymentSession(
    input: ProviderPaymentSessionRequest,
  ): Promise<ProviderPaymentSession>;
  capturePayment(input: {
    providerOrderId: string;
    idempotencyKey: string;
  }): Promise<ProviderPaymentStatus>;
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
    headers: PaymentWebhookHeaders,
  ): Promise<PaymentWebhookVerificationResult>;
  classifyError(error: unknown): ProviderErrorInfo;
}
