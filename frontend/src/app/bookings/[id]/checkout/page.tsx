import type { Metadata } from "next";
import { BookingCheckoutClient } from "@/components/checkout/booking-checkout-client";

interface BookingCheckoutPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata: Metadata = {
  title: "Checkout | Rentify",
  description:
    "Review your booking, price, and cancellation policy, then pay securely with PayPal.",
};

export default async function BookingCheckoutPage({
  params,
}: BookingCheckoutPageProps) {
  const { id } = await params;

  return <BookingCheckoutClient bookingRequestId={id} />;
}
