import type { Metadata } from "next";
import { OrganizationBlogListPage } from "@/components/organizations/organization-blog-list-page";

export const metadata: Metadata = {
  title: "Blog | Rentify",
  description: "Read the latest news and updates from this organization.",
};

export default async function OrganizationBlogRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <OrganizationBlogListPage id={id} />;
}
