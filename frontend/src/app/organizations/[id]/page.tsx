import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganizationPublicDetailPage } from "@/components/organizations/organization-public-detail-page";
import { resolveOrganizationPageReference } from "@/lib/organizations/resolve-page-reference";
import {
  organizationHref,
  resolveOrganizationReference,
} from "@/lib/organizations/urls";

// The segment is still named `id` so the folder stays put, but it now holds an
// organization reference: a canonical slug, a retired slug, or a UUID.
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

  if (!resolved) {
    return {
      title: "Organization | Rentify",
      description: "View a public organization profile on Rentify.",
    };
  }

  const canonical = organizationHref(resolved.canonicalSlug);

  return {
    title: `${resolved.name} | Rentify`,
    description: `View ${resolved.name}'s public organization profile on Rentify.`,
    alternates: { canonical },
    openGraph: {
      title: resolved.name,
      description: `View ${resolved.name}'s public organization profile on Rentify.`,
      url: canonical,
      type: "profile",
    },
  };
}

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { id: organizationReference } = await params;
  const resolved = await resolveOrganizationPageReference(
    organizationReference,
  );

  // Render a real 404 rather than forwarding an unresolvable reference into a
  // UUID-only endpoint, which would 400 and log a console error.
  if (!resolved) {
    notFound();
  }

  return <OrganizationPublicDetailPage id={resolved.organizationId} />;
}
