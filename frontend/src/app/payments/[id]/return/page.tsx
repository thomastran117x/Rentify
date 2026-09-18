import type { Metadata } from "next";
import { PaymentReturnClient } from "@/components/payments/payment-return-client";

interface PaymentReturnPageProps {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    cancelled?: string | string[];
    token?: string | string[];
  }>;
}

export const metadata: Metadata = {
  title: "Payment | Rentify",
  description: "Confirm your PayPal payment for a booking.",
};

export default async function PaymentReturnPage({
  params,
  searchParams,
}: PaymentReturnPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  return (
    <PaymentReturnClient
      paymentId={id}
      cancelled={query.cancelled === "1"}
      orderId={typeof query.token === "string" ? query.token : undefined}
    />
  );
}
