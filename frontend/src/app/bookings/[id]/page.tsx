import type { Metadata } from "next";
import { BookingDetailClient } from "@/components/bookings/booking-detail-client";

interface BookingDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata: Metadata = {
  title: "Booking Detail | Rentify",
  description:
    "Review a booking request and message the other party without leaving the platform.",
};

export default async function BookingDetailPage({
  params,
}: BookingDetailPageProps) {
  const { id } = await params;

  return <BookingDetailClient bookingRequestId={id} />;
}
