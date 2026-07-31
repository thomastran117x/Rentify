import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganizationBlogListPage } from "@/components/organizations/organization-blog-list-page";
import { resolveOrganizationPageReference } from "@/lib/organizations/resolve-page-reference";
import {
  organizationHref,
  resolveOrganizationReference,
} from "@/lib/organizations/urls";

interface RouteParams {
  id: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { id: organizationReference } = await params;

  let resolved = null;
  try {
    resolved = await resolveOrganizationReference(organizationReference);
  } catch {
    // Metadata must not take the page down; fall back to the generic title.
  }

  const description =
    "Read the latest news and updates from this organization.";

  if (!resolved) {
    return { title: "Blog | Rentify", description };
  }

  const canonical = organizationHref(resolved.canonicalSlug, "blog");

  return {
    title: `Blog | ${resolved.name} | Rentify`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `Blog | ${resolved.name}`,
      description,
      url: canonical,
    },
  };
}

export default async function OrganizationBlogRoute({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { id: organizationReference } = await params;
  const resolved = await resolveOrganizationPageReference(
    organizationReference,
    "blog",
  );

  if (!resolved) {
    notFound();
  }

  return (
    <OrganizationBlogListPage
      id={resolved.organizationId}
      organizationSlug={resolved.canonicalSlug}
    />
  );
}
