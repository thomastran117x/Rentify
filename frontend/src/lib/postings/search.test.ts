import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublicPostingAutocompleteError,
  fetchPublicPostingAutocomplete,
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
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            message: "Validation failed.",
            data: null,
            error: {
              code: "VALIDATION_ERROR",
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
});
