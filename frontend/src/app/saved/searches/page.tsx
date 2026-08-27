import type { Metadata } from "next";
import { SavedSearchesWorkspace } from "@/components/postings/saved-searches-workspace";

export const metadata: Metadata = {
  title: "Saved Searches | Rentify",
  description:
    "Manage the searches Rentify watches for you, and choose how often we email you about new matches.",
};

export default function SavedSearchesPage() {
  return <SavedSearchesWorkspace />;
}
