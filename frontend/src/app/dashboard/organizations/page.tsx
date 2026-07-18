import { redirect } from "next/navigation";

// Legacy `?tab=` deep links (from the previous single-page tab dashboard) are
// mapped onto the new section routes so existing bookmarks keep working.
const LEGACY_TAB_TO_SEGMENT: Record<string, string> = {
  overview: "overview",
  team: "team",
  postings: "postings",
  announcements: "content",
  blog: "content",
  activity: "activity",
  settings: "settings",
};

export default async function DashboardOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  const rawTab = Array.isArray(tab) ? tab[0] : tab;
  const segment = (rawTab && LEGACY_TAB_TO_SEGMENT[rawTab]) || "overview";
  // Preserve the Blog sub-view so `?tab=blog` bookmarks open the Blog editor
  // rather than the default Announcements sub-tab within Content.
  const query = rawTab === "blog" ? "?view=blog" : "";
  redirect(`/dashboard/organizations/${segment}${query}`);
}
