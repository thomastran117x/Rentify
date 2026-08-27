import { beforeEach, describe, expect, it, vi } from "vitest";
import { savedSearchesApi } from "./api";

const { authenticatedMock, pathMock } = vi.hoisted(() => ({
  authenticatedMock: vi.fn(),
  pathMock: vi.fn(
    (path: string, query: Record<string, unknown>) =>
      `${path}?${new URLSearchParams(
        Object.entries(query)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)]),
      ).toString()}`,
  ),
}));

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: authenticatedMock,
  buildPathWithQuery: pathMock,
}));

describe("savedSearchesApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls the paths and methods the backend registers", () => {
    savedSearchesApi.list();
    savedSearchesApi.list({ page: 2, pageSize: 50 });
    savedSearchesApi.create({ queryParams: { q: "kayak" } });
    savedSearchesApi.update("search-1", { notifyFrequency: "daily" });
    savedSearchesApi.remove("search-1");
    savedSearchesApi.markSeen("search-1");

    expect(authenticatedMock).toHaveBeenCalledWith(
      "GET",
      "/postings/saved/searches?page=1&pageSize=20",
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "GET",
      "/postings/saved/searches?page=2&pageSize=50",
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/postings/saved/searches",
      { queryParams: { q: "kayak" } },
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "PATCH",
      "/postings/saved/searches/search-1",
      { notifyFrequency: "daily" },
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "DELETE",
      "/postings/saved/searches/search-1",
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/postings/saved/searches/search-1/seen",
    );
  });

  it("escapes identifiers so a hostile id cannot reshape the path", () => {
    savedSearchesApi.remove("a/../b");

    expect(authenticatedMock).toHaveBeenCalledWith(
      "DELETE",
      "/postings/saved/searches/a%2F..%2Fb",
    );
  });
});
