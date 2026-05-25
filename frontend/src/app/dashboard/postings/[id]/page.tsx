import type { Metadata } from "next";
import { PostingDashboardDetail } from "@/components/dashboard/posting-dashboard-detail";

export const metadata: Metadata = {
  title: "Posting Analytics | Rentify",
  description:
    "Inspect live trend, outcomes, and conversion detail for a single posting.",
};

export default async function DashboardPostingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <PostingDashboardDetail postingId={id} />;
}
