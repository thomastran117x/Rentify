import type { Metadata } from "next";
import { SavedPostingsWorkspace } from "@/components/postings/saved-postings-workspace";

export const metadata: Metadata = {
  title: "Saved Postings | Rentify",
  description: "Browse the postings you saved while searching Rentify.",
};

export default function SavedPostingsPage() {
  return <SavedPostingsWorkspace />;
}
