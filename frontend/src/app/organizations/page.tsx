import type { Metadata } from "next";
import { Suspense } from "react";
import { OrganizationWorkspace } from "@/components/organizations/organization-workspace";

export const metadata: Metadata = {
  title: "Organizations | Rentify",
  description:
    "Manage organization memberships, pending invites, and your active workspace context on Rentify.",
};

export default function OrganizationsPage() {
  return (
    <Suspense fallback={null}>
      <OrganizationWorkspace />
    </Suspense>
  );
}
