import { buildOperationCatalog } from "@/openapi/coverage/catalog";
import { matchRequestSites } from "@/openapi/coverage/matcher";
import type { RequestSite } from "@/openapi/coverage/request-sites";
import type { HttpMethod } from "@/openapi/coverage/shared";

const catalog = buildOperationCatalog({
  paths: {
    "/postings": { get: { operationId: "listPostings", tags: ["postings"] } },
    "/postings/saved": {
      get: { operationId: "listSavedPostings", tags: ["postings"] },
    },
    "/postings/{id}": {
      get: { operationId: "getPostingById", tags: ["postings"] },
    },
    "/postings/{id}/save": {
      post: { operationId: "savePosting", tags: ["postings"] },
    },
    "/postings/{id}/reviews": {
      post: { operationId: "createPostingReview", tags: ["postings"] },
    },
  },
});

function siteWith(
  requests: Array<{ method: HttpMethod; pathPattern: string }>,
): RequestSite {
  return {
    file: "src/test/demo.routes.integration.test.ts",
    line: 1,
    suite: "route-contract",
    level: "explicit",
    requests,
    rawUrlText: "<test>",
    resolution: "resolved",
  };
}

function keysFor(method: HttpMethod, pathPattern: string): string[] {
  const [match] = matchRequestSites(
    [siteWith([{ method, pathPattern }])],
    catalog,
  );
  return [...match!.operationKeys];
}

describe("matchRequestSites", () => {
  it("prefers a static segment over a parameter, mirroring Hono dispatch", () => {
    expect(keysFor("GET", "/postings/saved")).toEqual(["GET /postings/saved"]);
  });

  it("credits a parameterised operation from a concrete id", () => {
    expect(keysFor("POST", "/postings/posting-1/save")).toEqual([
      "POST /postings/{id}/save",
    ]);
  });

  it("does not let a wildcard credit a sibling static route", () => {
    expect(keysFor("GET", "/postings/*")).toEqual(["GET /postings/{id}"]);
  });

  it("matches nothing when the method differs", () => {
    expect(keysFor("DELETE", "/postings/saved")).toEqual([]);
  });

  it("matches nothing when the segment count differs", () => {
    expect(keysFor("GET", "/postings/a/b/c")).toEqual([]);
  });

  it("reports an unmatched request rather than silently dropping it", () => {
    const [match] = matchRequestSites(
      [siteWith([{ method: "GET", pathPattern: "/nope" }])],
      catalog,
    );

    expect(match!.operationKeys).toEqual([]);
    expect(match!.unmatchedRequests).toEqual([
      { method: "GET", pathPattern: "/nope" },
    ]);
  });

  it("keeps rows independent within one site", () => {
    const [match] = matchRequestSites(
      [
        siteWith([
          { method: "GET", pathPattern: "/postings/saved" },
          { method: "POST", pathPattern: "/postings/p1/save" },
        ]),
      ],
      catalog,
    );

    expect([...match!.operationKeys].sort()).toEqual([
      "GET /postings/saved",
      "POST /postings/{id}/save",
    ]);
    expect(match!.unmatchedRequests).toEqual([]);
  });

  it("passes unresolved sites through without matching", () => {
    const [match] = matchRequestSites(
      [
        {
          ...siteWith([]),
          resolution: "unresolved",
          unresolvedReason: "dynamic-origin",
        },
      ],
      catalog,
    );

    expect(match!.operationKeys).toEqual([]);
    expect(match!.unmatchedRequests).toEqual([]);
  });

  it("flags an ambiguous match when candidates tie", () => {
    const ambiguousCatalog = buildOperationCatalog({
      paths: {
        "/a/{first}": { get: { operationId: "first", tags: [] } },
        "/a/{second}": { get: { operationId: "second", tags: [] } },
      },
    });

    const [match] = matchRequestSites(
      [siteWith([{ method: "GET", pathPattern: "/a/*" }])],
      ambiguousCatalog,
    );

    expect(match!.ambiguous).toBe(true);
    expect(match!.operationKeys).toHaveLength(2);
  });

  it("falls back non-strictly instead of dropping a wildcard-only match", () => {
    const staticOnlyCatalog = buildOperationCatalog({
      paths: { "/postings/saved": { get: { operationId: "x", tags: [] } } },
    });

    const [match] = matchRequestSites(
      [siteWith([{ method: "GET", pathPattern: "/postings/*" }])],
      staticOnlyCatalog,
    );

    expect(match!.quality).toBe("wildcard-fallback");
    expect(match!.operationKeys).toEqual(["GET /postings/saved"]);
  });
});
