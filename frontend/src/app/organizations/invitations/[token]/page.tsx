import type { Metadata } from "next";
import { OrganizationInvitePage } from "@/components/organizations/organization-invite-page";

export const metadata: Metadata = {
  title: "Organization Invite | Rentify",
  description:
    "Review and accept a Rentify organization invitation from your browser.",
};

interface OrganizationInviteRouteProps {
  params: Promise<{
    token: string;
  }>;
}

export default async function OrganizationInviteRoute({
  params,
}: OrganizationInviteRouteProps) {
  const { token } = await params;
  return <OrganizationInvitePage token={token} />;
}
