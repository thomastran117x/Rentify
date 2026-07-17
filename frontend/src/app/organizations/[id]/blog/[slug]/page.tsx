import type { Metadata } from "next";
import { serverEnv } from "@/lib/env";
import { OrganizationBlogPostPage } from "@/components/organizations/organization-blog-post-page";

interface RouteParams {
  id: string;
  slug: string;
}

async function fetchPost(id: string, slug: string) {
  try {
    const response = await fetch(
      `${serverEnv.internalApiBaseUrl}/organizations/${id}/blog/${encodeURIComponent(slug)}`,
      { headers: { accept: "application/json" }, cache: "no-store" },
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
  const { id, slug } = await params;
  const post = await fetchPost(id, slug);

  if (!post?.title) {
    return {
      title: "Blog post | Rentify",
      description: "Read the latest updates from this organization.",
    };
  }

  const description =
    post.excerpt ?? "Read the latest updates from this organization.";

  return {
    title: `${post.title} | Rentify`,
    description,
    openGraph: {
      title: post.title,
      description,
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
  const { id, slug } = await params;

  return <OrganizationBlogPostPage id={id} slug={slug} />;
}
