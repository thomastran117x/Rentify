import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("systemApi", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the canonical openapi yaml as text", async () => {
    const fetchMock = vi.fn(async () => new Response("openapi: 3.1.0", {
      status: 200,
      headers: {
        "content-type": "application/yaml",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { systemApi } = await import("./api");
    const yaml = await systemApi.getOpenApiYaml();

    expect(yaml).toBe("openapi: 3.1.0");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/openapi.yaml",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });
});
