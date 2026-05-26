import type { Metadata } from "next";
import { ModerationWorkspace } from "@/components/reports/moderation-workspace";

export const metadata: Metadata = {
  title: "Moderation | Rentify",
  description:
    "Review safety reports, assign moderation work, and resolve marketplace misconduct reports.",
};

export default function ModerationPage() {
  return <ModerationWorkspace />;
}
