import type { Metadata } from "next";
import { RentingDetailClient } from "@/components/rentings/renting-detail-client";

interface RentingDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata: Metadata = {
  title: "Renting Detail | Rentify",
  description:
    "Review the full record for a rental: lifecycle, instructions, payment receipt, and dispute status.",
};

export default async function RentingDetailPage({
  params,
}: RentingDetailPageProps) {
  const { id } = await params;

  return <RentingDetailClient rentingId={id} />;
}
