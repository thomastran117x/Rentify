import { describe, expect, it, vi } from "vitest";
import { resolveOrganizationPageReference } from "./resolve-page-reference";

const {
  resolveMock,
  canonicalMock,
  hrefMock,
  redirectMock,
  permanentRedirectMock,
} = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  canonicalMock: vi.fn(),
  hrefMock: vi.fn(),
  redirectMock: vi.fn(),
  permanentRedirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  permanentRedirect: permanentRedirectMock,
}));
vi.mock("./urls", () => ({
  resolveOrganizationReference: resolveMock,
  isCanonicalOrganizationReference: canonicalMock,
  organizationHref: hrefMock,
}));

describe("resolveOrganizationPageReference", () => {
  it("returns missing and canonical references without redirecting", async () => {
    resolveMock.mockResolvedValueOnce(null);
    await expect(
      resolveOrganizationPageReference("missing"),
    ).resolves.toBeNull();

    const resolved = {
      organizationId: "org-1",
      canonicalSlug: "studio",
      name: "Studio",
      matchedBy: "canonical-slug",
    };
    resolveMock.mockResolvedValueOnce(resolved);
    canonicalMock.mockReturnValueOnce(true);
    await expect(
      resolveOrganizationPageReference("studio", "blog"),
    ).resolves.toEqual(resolved);
  });

  it("uses temporary UUID redirects and permanent alias redirects", async () => {
    hrefMock.mockReturnValue("/organizations/studio/blog");
    resolveMock.mockResolvedValueOnce({
      organizationId: "org-1",
      canonicalSlug: "studio",
      name: "Studio",
      matchedBy: "uuid",
    });
    canonicalMock.mockReturnValueOnce(false);
    await resolveOrganizationPageReference("uuid", "blog");
    expect(redirectMock).toHaveBeenCalledWith("/organizations/studio/blog");

    resolveMock.mockResolvedValueOnce({
      organizationId: "org-1",
      canonicalSlug: "studio",
      name: "Studio",
      matchedBy: "alias",
    });
    canonicalMock.mockReturnValueOnce(false);
    await resolveOrganizationPageReference("old-studio", "blog");
    expect(permanentRedirectMock).toHaveBeenCalledWith(
      "/organizations/studio/blog",
    );
  });
});
