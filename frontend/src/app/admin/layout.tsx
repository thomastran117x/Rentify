import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminGuard } from "@/components/admin/admin-guard";

export const metadata: Metadata = {
  title: "Admin | Rentify",
  description: "Administrator tools for investigating account security.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
