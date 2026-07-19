import { ContentPanel } from "@/components/organizations/workspace/panels/content-panel";

export default async function OrganizationContentPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { view } = await searchParams;
  const rawView = Array.isArray(view) ? view[0] : view;
  const initialTab =
    rawView === "blog"
      ? "blog"
      : rawView === "reviews"
        ? "reviews"
        : "announcements";
  return <ContentPanel initialTab={initialTab} />;
}
