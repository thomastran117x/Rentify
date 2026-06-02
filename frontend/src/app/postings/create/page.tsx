import type { Metadata } from "next";
import { PostingManagementWorkspace } from "@/components/postings/posting-management-workspace";

export const metadata: Metadata = {
  title: "Posting Workspace | Rentify",
  description:
    "Create and manage organization-owned postings for your active Rentify workspace.",
};

export default function PostingCreatePage() {
  return <PostingManagementWorkspace />;
}
