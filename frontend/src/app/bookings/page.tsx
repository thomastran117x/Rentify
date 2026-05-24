import type { Metadata } from "next";
import { BookingsDashboard } from "@/components/bookings/bookings-dashboard";

export const metadata: Metadata = {
  title: "Bookings | Rentify",
  description: "Track booking requests, payments, upcoming rentings, and owner actions in one workspace.",
};

export default function BookingsPage() {
  return <BookingsDashboard />;
}
