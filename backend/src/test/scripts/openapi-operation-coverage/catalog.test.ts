import { buildOperationCatalog } from "@/openapi/coverage/catalog";

function documentWith(paths: Record<string, unknown>): Record<string, unknown> {
  return { paths };
}

describe("buildOperationCatalog", () => {
  it("flattens path items into keyed operations", () => {
    const catalog = buildOperationCatalog(
      documentWith({
        "/postings/{id}/reviews": {
          get: { operationId: "listPostingReviews", tags: ["postings"] },
          post: { operationId: "createPostingReview", tags: ["postings"] },
        },
      }),
    );

    expect(catalog).toHaveLength(2);
    expect(catalog.map((entry) => entry.key)).toEqual([
      "GET /postings/{id}/reviews",
      "POST /postings/{id}/reviews",
    ]);
    expect(catalog[0]).toMatchObject({
      method: "GET",
      path: "/postings/{id}/reviews",
      operationId: "listPostingReviews",
      tags: ["postings"],
    });
  });

  it("ignores non-method keys in a path item", () => {
    const catalog = buildOperationCatalog(
      documentWith({
        "/health": {
          get: { operationId: "getHealth", tags: ["system"] },
          parameters: [],
          summary: "Health",
        },
      }),
    );

    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.operationId).toBe("getHealth");
  });

  it("splits paths into literal and parameter segments", () => {
    const catalog = buildOperationCatalog(
      documentWith({
        "/postings/{id}/reviews": { get: { operationId: "x", tags: [] } },
      }),
    );

    expect(catalog[0]!.segments).toEqual([
      { kind: "literal", value: "postings" },
      { kind: "parameter", name: "id" },
      { kind: "literal", value: "reviews" },
    ]);
  });

  it("rejects wildcard paths the matcher cannot reason about", () => {
    expect(() =>
      buildOperationCatalog(
        documentWith({ "/files/*": { get: { operationId: "x", tags: [] } } }),
      ),
    ).toThrow(/uses a wildcard/);
  });

  it("rejects a document without a paths object", () => {
    expect(() => buildOperationCatalog({})).toThrow(/must include a paths/);
  });
});
