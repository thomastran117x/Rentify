import { describe, expect, it } from "vitest";
import {
  FRESH_SEARCH_BASE,
  buildFamilyFacetHref,
  buildLocationFacetHref,
  buildPostingFacetHrefs,
  buildSubtypeFacetHref,
  buildTagFacetHref,
  isTagActive,
  type FacetSearchBase,
} from "./facet-href";

function paramsOf(href: string): URLSearchParams {
  return new URL(href, "https://rentify.local").searchParams;
}

const location = { city: "Toronto", region: "Ontario", country: "Canada" };

describe("buildTagFacetHref", () => {
  it("adds the tag to the tags already applied and resets to page one", () => {
    const base: FacetSearchBase = {
      q: "loft",
      tags: ["wifi"],
      sort: "newest",
      pageSize: 50,
    };

    const params = paramsOf(buildTagFacetHref(base, "desk"));

    expect(params.getAll("tags")).toEqual(["wifi", "desk"]);
    expect(params.get("q")).toBe("loft");
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("50");
  });

  it("removes a tag that is already applied, ignoring case", () => {
    const base: FacetSearchBase = {
      tags: ["WiFi", "desk"],
      sort: "relevance",
      pageSize: 20,
    };

    expect(isTagActive(base, "wifi")).toBe(true);
    expect(paramsOf(buildTagFacetHref(base, "wifi")).getAll("tags")).toEqual([
      "desk",
    ]);
  });

  it("starts a fresh search when there is no current search", () => {
    expect(isTagActive(FRESH_SEARCH_BASE, "wifi")).toBe(false);
    expect(buildTagFacetHref(FRESH_SEARCH_BASE, "wifi")).toBe(
      "/postings?sort=relevance&page=1&pageSize=20&tags=wifi",
    );
  });
});

describe("category facets", () => {
  it("clears the subtype when switching family", () => {
    const params = paramsOf(
      buildFamilyFacetHref(
        { family: "place", subtype: "workspace", sort: "newest", pageSize: 20 },
        "vehicle",
      ),
    );

    expect(params.get("family")).toBe("vehicle");
    expect(params.has("subtype")).toBe(false);
  });

  it("sets the family alongside the subtype", () => {
    const params = paramsOf(
      buildSubtypeFacetHref(
        { family: "equipment", sort: "newest", pageSize: 20 },
        { family: "vehicle", subtype: "car" },
      ),
    );

    expect(params.get("family")).toBe("vehicle");
    expect(params.get("subtype")).toBe("car");
  });
});

describe("buildLocationFacetHref", () => {
  it("keeps the broader levels when filtering by city", () => {
    const params = paramsOf(
      buildLocationFacetHref(FRESH_SEARCH_BASE, "city", location),
    );

    expect(params.get("city")).toBe("Toronto");
    expect(params.get("region")).toBe("Ontario");
    expect(params.get("country")).toBe("Canada");
  });

  it("drops the narrower levels when broadening", () => {
    const base: FacetSearchBase = {
      ...FRESH_SEARCH_BASE,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    };

    const regionParams = paramsOf(
      buildLocationFacetHref(base, "region", location),
    );
    expect(regionParams.has("city")).toBe(false);
    expect(regionParams.get("region")).toBe("Ontario");

    const countryParams = paramsOf(
      buildLocationFacetHref(base, "country", location),
    );
    expect(countryParams.has("city")).toBe(false);
    expect(countryParams.has("region")).toBe(false);
    expect(countryParams.get("country")).toBe("Canada");
  });

  it("skips location parts the posting does not have", () => {
    const params = paramsOf(
      buildLocationFacetHref(FRESH_SEARCH_BASE, "city", {
        city: "Toronto",
        region: null,
        country: "Canada",
      }),
    );

    expect(params.has("region")).toBe(false);
  });
});

describe("buildPostingFacetHrefs", () => {
  it("binds every facet to the posting and the current search", () => {
    const hrefs = buildPostingFacetHrefs(
      { ...FRESH_SEARCH_BASE, tags: ["loft"] },
      { variant: { family: "place", subtype: "workspace" }, location },
    );

    expect(hrefs.isTagActive("loft")).toBe(true);
    expect(paramsOf(hrefs.tag("wifi")).getAll("tags")).toEqual([
      "loft",
      "wifi",
    ]);
    expect(paramsOf(hrefs.family()).get("family")).toBe("place");
    expect(paramsOf(hrefs.subtype()).get("subtype")).toBe("workspace");
    expect(paramsOf(hrefs.location("country")).get("country")).toBe("Canada");
  });
});
