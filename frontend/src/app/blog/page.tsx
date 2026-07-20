import type { Metadata } from "next";
import { BlogSearchPage } from "@/components/organizations/blog-search-page";

export const metadata: Metadata = {
  title: "Blog | Rentify",
  description:
    "Search published news, guides, and announcements from organizations across Rentify.",
};

export default function BlogFeedRoute() {
  return <BlogSearchPage />;
}
