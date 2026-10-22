import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminSecurityWorkspace } from "@/components/admin/security/admin-security-workspace";

export const metadata: Metadata = {
  title: "Sign-in activity | Admin | Rentify",
  description:
    "Search authentication events across every account and review a user's sign-in security.",
};

export default function AdminSecurityPage() {
  return (
    <Suspense fallback={null}>
      <AdminSecurityWorkspace />
    </Suspense>
  );
}
