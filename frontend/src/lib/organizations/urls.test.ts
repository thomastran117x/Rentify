import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ORGANIZATION_UUID_PATTERN,
  OrganizationResolutionError,
  isCanonicalOrganizationReference,
  normalizeOrganizationReference,
  organizationHref,
  resolveOrganizationReference,
} from "@/lib/organizations/urls";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal("fetch", createFetchMock(status, body));
}

// Typing the mock as fetch-shaped keeps `mock.calls[n]` a populated tuple; a
// bare `vi.fn(async () => ...)` infers zero parameters, so indexing the
// recorded arguments is a type error.
type FetchMockFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function createFetchMock(status: number, body: unknown) {
  return vi.fn<FetchMockFn>(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

function stubResolvedOrganizationFetch() {
  const fetchMock = createFetchMock(200, {
    data: {
      organizationId: "org-1",
      canonicalSlug: "harbor-rentals",
      name: "Harbor Rentals",
      matchedBy: "canonical-slug",
    },
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("organizationHref", () => {
  it("builds the public organization URL", () => {
    expect(organizationHref("harbor-rentals")).toBe(
      "/organizations/harbor-rentals",
    );
  });

  it("appends trailing segments", () => {
    expect(organizationHref("harbor-rentals", "blog")).toBe(
      "/organizations/harbor-rentals/blog",
    );
    expect(organizationHref("harbor-rentals", "blog", "my-post")).toBe(
      "/organizations/harbor-rentals/blog/my-post",
    );
  });

  it("encodes segments", () => {
    expect(organizationHref("harbor-rentals", "blog", "a b")).toBe(
      "/organizations/harbor-rentals/blog/a%20b",
    );
  });

  it("skips empty segments", () => {
    expect(organizationHref("harbor-rentals", "")).toBe(
      "/organizations/harbor-rentals",
    );
  });
});

describe("normalizeOrganizationReference", () => {
  it("lowercases", () => {
    expect(normalizeOrganizationReference("Harbor-Rentals")).toBe(
      "harbor-rentals",
    );
  });

  it("strips a trailing slash", () => {
    expect(normalizeOrganizationReference("harbor-rentals/")).toBe(
      "harbor-rentals",
    );
  });

  it("decodes percent-encoding", () => {
    expect(normalizeOrganizationReference("%68arbor-rentals")).toBe(
      "harbor-rentals",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeOrganizationReference("  harbor-rentals  ")).toBe(
      "harbor-rentals",
    );
  });

  it("passes malformed encoding through rather than throwing", () => {
    expect(() => normalizeOrganizationReference("%E0%A4%A")).not.toThrow();
  });
});

describe("ORGANIZATION_UUID_PATTERN", () => {
  it("matches a UUID reference", () => {
    expect(
      ORGANIZATION_UUID_PATTERN.test("00000000-0000-0000-1040-000000000001"),
    ).toBe(true);
  });

  it("does not match a slug", () => {
    expect(ORGANIZATION_UUID_PATTERN.test("harbor-rentals")).toBe(false);
  });
});

describe("isCanonicalOrganizationReference", () => {
  it("is true only for an exact match", () => {
    expect(isCanonicalOrganizationReference("harbor", "harbor")).toBe(true);
    expect(isCanonicalOrganizationReference("Harbor", "harbor")).toBe(false);
    expect(isCanonicalOrganizationReference("old-harbor", "harbor")).toBe(
      false,
    );
  });
});

describe("resolveOrganizationReference", () => {
  it("resolves a canonical slug", async () => {
    mockFetchOnce(200, {
      data: {
        organizationId: "org-1",
        canonicalSlug: "harbor-rentals",
        name: "Harbor Rentals",
        matchedBy: "canonical-slug",
      },
    });

    await expect(
      resolveOrganizationReference("harbor-rentals"),
    ).resolves.toMatchObject({
      organizationId: "org-1",
      canonicalSlug: "harbor-rentals",
      matchedBy: "canonical-slug",
    });
  });

  it("reports a retired slug as an alias", async () => {
    mockFetchOnce(200, {
      data: {
        organizationId: "org-1",
        canonicalSlug: "harbor-rentals-canada",
        name: "Harbor Rentals",
        matchedBy: "alias",
      },
    });

    const resolved = await resolveOrganizationReference("harbor-rentals");

    expect(resolved?.matchedBy).toBe("alias");
    expect(resolved?.canonicalSlug).toBe("harbor-rentals-canada");
  });

  it("resolves a UUID reference through the organization detail endpoint", async () => {
    mockFetchOnce(200, {
      data: {
        organization: {
          id: "00000000-0000-0000-1040-000000000001",
          slug: "harbor-rentals",
          name: "Harbor Rentals",
        },
      },
    });

    const resolved = await resolveOrganizationReference(
      "00000000-0000-0000-1040-000000000001",
    );

    expect(resolved?.matchedBy).toBe("uuid");
    expect(resolved?.canonicalSlug).toBe("harbor-rentals");
  });

  it("returns null when the organization does not exist", async () => {
    mockFetchOnce(404, null);

    await expect(resolveOrganizationReference("nope-nope")).resolves.toBeNull();
  });

  it("returns null for a reference the API rejects as unusable", async () => {
    mockFetchOnce(400, null);

    await expect(resolveOrganizationReference("!!")).resolves.toBeNull();
  });

  it("throws rather than reporting not-found when the backend fails", async () => {
    // Collapsing a 500 into null would render a not-found page during an
    // outage and silently skip canonical redirection.
    mockFetchOnce(500, null);

    await expect(
      resolveOrganizationReference("harbor-rentals"),
    ).rejects.toBeInstanceOf(OrganizationResolutionError);
  });

  it("throws when the payload is missing the fields it promises", async () => {
    mockFetchOnce(200, { data: { canonicalSlug: "harbor-rentals" } });

    await expect(
      resolveOrganizationReference("harbor-rentals"),
    ).rejects.toBeInstanceOf(OrganizationResolutionError);
  });

  it("normalizes the reference before calling the API", async () => {
    const fetchMock = stubResolvedOrganizationFetch();

    await resolveOrganizationReference("Harbor-Rentals/");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/organizations/by-slug/harbor-rentals",
    );
  });

  it("does not cache resolutions, because slugs are mutable", async () => {
    const fetchMock = stubResolvedOrganizationFetch();

    await resolveOrganizationReference("harbor-rentals");

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
  });
});
