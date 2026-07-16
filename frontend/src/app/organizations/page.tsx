import type { Metadata } from "next";
import { Suspense } from "react";
import { OrganizationDirectoryPage } from "@/components/organizations/organization-directory-page";

export const metadata: Metadata = {
  title: "Organizations | Rentify",
  description:
    "Browse public organizations with published Rentify postings.",
};

export default function OrganizationsPage() {
  return (
    <Suspense fallback={null}>
      <OrganizationDirectoryPage />
    </Suspense>
  );
}
