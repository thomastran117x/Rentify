import { OrganizationsPublicSearchRepository } from "@/features/organizations/search/public-search.repository";

function sqlText(arg: unknown): string {
  const value = arg as { strings?: string[]; text?: string };
  if (value?.strings) {
    return value.strings.join(" ");
  }
  return value?.text ?? String(arg);
}

function organizationRow(id: string) {
  return {
    id,
    name: `Org ${id}`,
    description: "d",
    city: "Berlin",
    region: "BE",
    country: "DE",
    postalCode: "10115",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
  };
}

function createDb(config?: { queryRaw?: (text: string) => unknown }) {
  return {
    $queryRaw: jest.fn(async (arg: unknown) =>
      config?.queryRaw ? config.queryRaw(sqlText(arg)) : [],
    ),
  };
}

function repoWith(db: Record<string, unknown>) {
  return new OrganizationsPublicSearchRepository(db as any);
}

describe("OrganizationsPublicSearchRepository", () => {
  it("returns ordered ids and a total for a query", async () => {
    const db = createDb({
      queryRaw: (text) =>
        text.includes("COUNT(*)")
          ? [{ total: 2 }]
          : [{ id: "org-1" }, { id: "org-2" }],
    });
    const result = await repoWith(db).searchPublicFallback({
      page: 1,
      pageSize: 20,
      query: "acme",
      sort: "nameAsc",
    });
    expect(result).toEqual({ ids: ["org-1", "org-2"], total: 2 });
  });

  it("supports every sort option in the fallback", async () => {
    const db = createDb({ queryRaw: () => [] });
    const repo = repoWith(db);
    for (const sort of [
      "relevance",
      "nameAsc",
      "nameDesc",
      "newest",
      "oldest",
      undefined,
    ] as const) {
      await repo.searchPublicFallback({ page: 1, pageSize: 20, sort });
    }
    expect((db.$queryRaw as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it("hydrates public rows by id, preserving order", async () => {
    const db = createDb({
      queryRaw: () => [
        {
          ...organizationRow("org-2"),
          websiteUrl: null,
          addressLine1: null,
          addressLine2: null,
          logoUrl: null,
          customFields: null,
          publishedPostingCount: 4,
        },
        {
          ...organizationRow("org-1"),
          websiteUrl: null,
          addressLine1: null,
          addressLine2: null,
          logoUrl: null,
          customFields: null,
          publishedPostingCount: 1,
        },
      ],
    });
    const rows = await repoWith(db).batchFindPublicByIds(["org-1", "org-2"]);
    expect(rows.map((row) => row.id)).toEqual(["org-1", "org-2"]);
    expect(rows[0]?.publishedPostingCount).toBe(1);
  });

  it("returns an empty hydration for empty id lists", async () => {
    const db = createDb();
    expect(await repoWith(db).batchFindPublicByIds([])).toEqual([]);
  });
});
