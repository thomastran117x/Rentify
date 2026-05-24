import assert from "node:assert/strict";

const {
  PublicPostingAutocompleteError,
  fetchPublicPostingAutocomplete,
} = await import(new URL("./search.ts", import.meta.url).href);

const originalFetch = globalThis.fetch;

try {
  let lastRequestUrl = "";

  globalThis.fetch = async (input) => {
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
  };

  const result = await fetchPublicPostingAutocomplete({
    q: "tor",
    family: "place",
    subtype: "entire_place",
    limit: 6,
  });

  assert.equal(result.query, "tor");
  assert.equal(result.suggestions[0]?.value, "Downtown Toronto Loft");

  const requestUrl = new URL(lastRequestUrl);
  assert.equal(requestUrl.pathname, "/api/v1/postings/autocomplete");
  assert.equal(requestUrl.searchParams.get("q"), "tor");
  assert.equal(requestUrl.searchParams.get("family"), "place");
  assert.equal(requestUrl.searchParams.get("subtype"), "entire_place");
  assert.equal(requestUrl.searchParams.get("limit"), "6");

  globalThis.fetch = async () =>
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
    );

  await assert.rejects(
    () =>
      fetchPublicPostingAutocomplete({
        q: "t",
      }),
    (error: unknown) => {
      if (!(error instanceof PublicPostingAutocompleteError)) {
        return false;
      }

      const autocompleteError = error as InstanceType<typeof PublicPostingAutocompleteError>;

      return (
        autocompleteError.debug.status === 400 &&
        autocompleteError.message === "Validation failed."
      );
    },
  );

  const abortError = new DOMException("The user aborted a request.", "AbortError");
  globalThis.fetch = async () => {
    throw abortError;
  };

  await assert.rejects(
    () =>
      fetchPublicPostingAutocomplete(
        {
          q: "tor",
        },
        {
          signal: new AbortController().signal,
        },
      ),
    (error: unknown) => error === abortError,
  );
} finally {
  globalThis.fetch = originalFetch;
}
