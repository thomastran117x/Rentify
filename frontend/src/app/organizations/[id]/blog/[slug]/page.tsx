import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverEnv } from "@/lib/env";
import { getClientAppHeader } from "@/lib/api/client-app";
import { OrganizationBlogPostPage } from "@/components/organizations/organization-blog-post-page";
import { resolveOrganizationPageReference } from "@/lib/organizations/resolve-page-reference";
import {
  organizationHref,
  resolveOrganizationReference,
} from "@/lib/organizations/urls";

interface RouteParams {
  // Organization reference: canonical slug, retired slug, or UUID.
  id: string;
  // Blog post slug (scoped to the organization).
  slug: string;
}

async function fetchPost(organizationId: string, slug: string) {
  try {
    const response = await fetch(
      `${serverEnv.internalApiBaseUrl}/organizations/${organizationId}/blog/${encodeURIComponent(slug)}`,
      {
        headers: { accept: "application/json", ...getClientAppHeader() },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      data?: {
        title?: string;
        excerpt?: string;
        coverImageUrl?: string;
      } | null;
    };

    return payload.data ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { id: organizationReference, slug } = await params;

  let resolved = null;
  try {
    resolved = await resolveOrganizationReference(organizationReference);
  } catch {
    // Metadata must not take the page down; fall back to the generic title.
  }

  const fallback = {
    title: "Blog post | Rentify",
    description: "Read the latest updates from this organization.",
  };

  if (!resolved) {
    return fallback;
  }

  const post = await fetchPost(resolved.organizationId, slug);

  if (!post?.title) {
    return fallback;
  }

  const description =
    post.excerpt ?? "Read the latest updates from this organization.";
  const canonical = organizationHref(resolved.canonicalSlug, "blog", slug);

  return {
    title: `${post.title} | Rentify`,
    description,
    alternates: { canonical },
    openGraph: {
      title: post.title,
      description,
      url: canonical,
      type: "article",
      ...(post.coverImageUrl ? { images: [{ url: post.coverImageUrl }] } : {}),
    },
  };
}

export default async function OrganizationBlogPostRoute({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { id: organizationReference, slug } = await params;
  const resolved = await resolveOrganizationPageReference(
    organizationReference,
    "blog",
    slug,
  );

  if (!resolved) {
    notFound();
  }

  return (
    <OrganizationBlogPostPage
      id={resolved.organizationId}
      slug={slug}
      organizationSlug={resolved.canonicalSlug}
    />
  );
}
