import type { Metadata } from "next";
import { RecentlyViewedWorkspace } from "@/components/postings/recently-viewed-workspace";

export const metadata: Metadata = {
  title: "Recently Viewed | Rentify",
  description:
    "Find your way back to the postings you opened while browsing Rentify.",
};

export default function RecentlyViewedPage() {
  return <RecentlyViewedWorkspace />;
}
