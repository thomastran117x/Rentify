import type { Metadata } from "next";
import { PostingsDashboard } from "@/components/postings/postings-dashboard";

export const metadata: Metadata = {
  title: "Postings | Rentify",
  description:
    "Manage every listing owned by your active Rentify organization — filter by status, search, and update posting states.",
};

export default function PostingsManagePage() {
  return <PostingsDashboard />;
}
