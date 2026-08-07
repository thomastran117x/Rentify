import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OrganizationDetailPage, {
  generateMetadata as detailMetadata,
} from "./organizations/[id]/page";
import OrganizationBlogRoute, {
  generateMetadata as blogMetadata,
} from "./organizations/[id]/blog/page";
import OrganizationBlogPostRoute, {
  generateMetadata as postMetadata,
} from "./organizations/[id]/blog/[slug]/page";

const { resolvePageMock, resolveMock, fetchMock } = vi.hoisted(() => ({
  resolvePageMock: vi.fn(),
  resolveMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/lib/organizations/resolve-page-reference", () => ({
  resolveOrganizationPageReference: resolvePageMock,
}));
vi.mock("@/lib/organizations/urls", () => ({
  resolveOrganizationReference: resolveMock,
  organizationHref: (slug: string, ...segments: string[]) =>
    `/organizations/${slug}${segments.length ? `/${segments.join("/")}` : ""}`,
}));
vi.mock("@/lib/env", () => ({
  serverEnv: { internalApiBaseUrl: "http://api.test" },
}));
vi.mock("@/components/organizations/organization-public-detail-page", () => ({
  OrganizationPublicDetailPage: ({ id }: { id: string }) => <div>Public {id}</div>,
}));
vi.mock("@/components/organizations/organization-blog-list-page", () => ({
  OrganizationBlogListPage: ({ id, organizationSlug }: { id: string; organizationSlug: string }) =>
    <div>Blog {id} {organizationSlug}</div>,
}));
vi.mock("@/components/organizations/organization-blog-post-page", () => ({
  OrganizationBlogPostPage: ({ id, slug }: { id: string; slug: string }) =>
    <div>Post {id} {slug}</div>,
}));

describe("public organization routes", () => {
  const params = Promise.resolve({ id: "studio", slug: "opening-day" });

  it("renders public detail and blog views using the resolved organization", async () => {
    resolvePageMock.mockResolvedValue({ organizationId: "org-1", canonicalSlug: "studio" });

    render(await OrganizationDetailPage({ params: Promise.resolve({ id: "studio" }) }));
    render(await OrganizationBlogRoute({ params: Promise.resolve({ id: "studio" }) }));
    render(await OrganizationBlogPostRoute({ params }));

    expect(screen.getByText("Public org-1")).toBeInTheDocument();
    expect(screen.getByText("Blog org-1 studio")).toBeInTheDocument();
    expect(screen.getByText("Post org-1 opening-day")).toBeInTheDocument();
    expect(resolvePageMock).toHaveBeenCalledWith("studio", "blog", "opening-day");
  });

  it("creates canonical metadata and safely falls back when resolution fails", async () => {
    resolveMock.mockResolvedValue({ organizationId: "org-1", canonicalSlug: "studio", name: "Studio Co" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { title: "Opening day", excerpt: "Welcome" } }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(detailMetadata({ params: Promise.resolve({ id: "studio" }) })).resolves.toMatchObject({
      title: "Studio Co | Rentify", alternates: { canonical: "/organizations/studio" },
    });
    await expect(blogMetadata({ params: Promise.resolve({ id: "studio" }) })).resolves.toMatchObject({
      title: "Blog | Studio Co | Rentify", alternates: { canonical: "/organizations/studio/blog" },
    });
    await expect(postMetadata({ params })).resolves.toMatchObject({
      title: "Opening day | Rentify", alternates: { canonical: "/organizations/studio/blog/opening-day" },
    });

    resolveMock.mockRejectedValueOnce(new Error("offline"));
    await expect(detailMetadata({ params: Promise.resolve({ id: "studio" }) })).resolves.toMatchObject({
      title: "Organization | Rentify",
    });
  });
});
