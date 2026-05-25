import type { Metadata } from "next";
import { OwnerDashboard } from "@/components/dashboard/owner-dashboard";

export const metadata: Metadata = {
  title: "Owner Dashboard | Rentify",
  description:
    "Track posting impressions, requests, confirmations, and revenue in one owner workspace.",
};

export default function DashboardPage() {
  return <OwnerDashboard />;
}
