import { describe, expect, it } from "vitest";
import { buildSearchHref } from "./search-href";

describe("buildSearchHref", () => {
  it("carries the organization filters across pagination", () => {
    const href = buildSearchHref({
      organization: "Maya Santos Organization",
      sort: "relevance",
      page: 3,
      pageSize: 20,
    });

    const params = new URL(href, "https://rentify.local").searchParams;
    expect(params.get("organization")).toBe("Maya Santos Organization");
    expect(params.get("page")).toBe("3");
  });

  it("carries an exact organization id across pagination", () => {
    const href = buildSearchHref({
      organizationId: "6f1c8b2e-6b0a-4f0e-9b6e-2f9a1c2d3e4f",
      sort: "organizationAsc",
      page: 2,
      pageSize: 10,
    });

    const params = new URL(href, "https://rentify.local").searchParams;
    expect(params.get("organizationId")).toBe(
      "6f1c8b2e-6b0a-4f0e-9b6e-2f9a1c2d3e4f",
    );
    expect(params.get("sort")).toBe("organizationAsc");
  });

  it("omits organization filters that were explicitly cleared", () => {
    const href = buildSearchHref({
      organization: undefined,
      organizationId: undefined,
      q: "loft",
      sort: "relevance",
      page: 1,
      pageSize: 20,
    });

    const params = new URL(href, "https://rentify.local").searchParams;
    expect(params.has("organization")).toBe(false);
    expect(params.has("organizationId")).toBe(false);
    expect(params.get("q")).toBe("loft");
  });

  it("preserves the other filters it is responsible for", () => {
    const href = buildSearchHref({
      q: "loft",
      family: "place",
      subtype: "workspace",
      tags: ["wifi", "desk"],
      availabilityStatus: "available",
      minDailyPrice: 50,
      maxDailyPrice: 250,
      latitude: 43.65,
      longitude: -79.38,
      radiusKm: 10,
      startAt: "2026-06-14T15:00:00.000Z",
      endAt: "2026-06-17T11:00:00.000Z",
      sort: "newest",
      page: 1,
      pageSize: 50,
    });

    const params = new URL(href, "https://rentify.local").searchParams;
    expect(params.getAll("tags")).toEqual(["wifi", "desk"]);
    expect(params.get("family")).toBe("place");
    expect(params.get("radiusKm")).toBe("10");
    expect(params.get("endAt")).toBe("2026-06-17T11:00:00.000Z");
  });
});
