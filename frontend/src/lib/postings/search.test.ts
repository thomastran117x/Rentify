import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublicPostingAutocompleteError,
  fetchPublicPostingAutocomplete,
  searchPublicPostings,
} from "./search";

describe("fetchPublicPostingAutocomplete", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the autocomplete request and returns suggestions", async () => {
    let lastRequestUrl = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        lastRequestUrl = String(input);

        return new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              query: "tor",
              suggestions: [
                { value: "Downtown Toronto Loft", kind: "name" },
                { value: "toronto", kind: "tag" },
              ],
              source: "elasticsearch",
            },
            error: null,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }),
    );

    const result = await fetchPublicPostingAutocomplete({
      q: "tor",
      family: "place",
      subtype: "entire_place",
      limit: 6,
    });

    expect(result.query).toBe("tor");
    expect(result.suggestions[0]?.value).toBe("Downtown Toronto Loft");

    const requestUrl = new URL(lastRequestUrl);
    expect(requestUrl.pathname).toBe("/api/v1/postings/autocomplete");
    expect(requestUrl.searchParams.get("q")).toBe("tor");
    expect(requestUrl.searchParams.get("family")).toBe("place");
    expect(requestUrl.searchParams.get("subtype")).toBe("entire_place");
    expect(requestUrl.searchParams.get("limit")).toBe("6");
  });

  it("throws a typed error for API validation failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              message: "Validation failed.",
              data: null,
              error: {
                code: "VALIDATION_ERROR",
                details: {
                  q: "too_short",
                },
              },
            }),
            {
              status: 400,
              statusText: "Bad Request",
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      ),
    );

    await expect(
      fetchPublicPostingAutocomplete({
        q: "t",
      }),
    ).rejects.toMatchObject<Partial<PublicPostingAutocompleteError>>({
      message: "Validation failed.",
      debug: {
        status: 400,
        responseBody: {
          q: "too_short",
        },
      },
    });
  });

  it("preserves network failure details in the domain error debug payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(
      searchPublicPostings({
        q: "toronto loft",
      }),
    ).rejects.toMatchObject<Partial<Error & { debug: unknown }>>({
      message: "Unable to reach the server.",
      debug: {
        requestUrl: "/postings?q=toronto+loft",
        causeMessage: "fetch failed",
      },
    });
  });

  it("rethrows abort errors unchanged", async () => {
    const abortError = new Error("The user aborted a request.");
    abortError.name = "AbortError";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abortError;
      }),
    );

    await expect(
      fetchPublicPostingAutocomplete(
        {
          q: "tor",
        },
        {
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toBe(abortError);
  });

  it("searches postings safely during server rendering", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              postings: [
                {
                  id: "posting-1",
                  name: "Beltline Designer Flat",
                  description: "Sunlit flat with polished interiors.",
                  variant: {
                    family: "place",
                    subtype: "entire_place",
                  },
                  pricing: {
                    currency: "CAD",
                    daily: {
                      amount: 210,
                    },
                  },
                  location: {
                    city: "Calgary",
                    region: "Alberta",
                    country: "Canada",
                  },
                  tags: ["beltline"],
                  availabilityStatus: "available",
                },
              ],
              pagination: {
                page: 1,
                pageSize: 20,
                total: 1,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              },
              source: "database",
            },
            error: null,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalNavigator = globalThis.navigator;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });

    try {
      const result = await searchPublicPostings({
        q: "Beltline Designer Flat",
        page: 1,
        pageSize: 20,
        sort: "relevance",
      });

      expect(result.postings[0]?.name).toBe("Beltline Designer Flat");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8040/api/v1/postings?q=Beltline+Designer+Flat&page=1&pageSize=20&sort=relevance",
        expect.objectContaining({
          headers: {
            accept: "application/json",
          },
        }),
      );
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
      });
    }
  });
});
