import type { Metadata } from "next";
import { OrganizationPublicDetailPage } from "@/components/organizations/organization-public-detail-page";

export const metadata: Metadata = {
  title: "Organization | Rentify",
  description: "View a public organization profile on Rentify.",
};

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <OrganizationPublicDetailPage id={id} />;
}
