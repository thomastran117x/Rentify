import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, dynamic } from "./route";

describe("Apple Pay domain association route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves the configured association file at request time", async () => {
    vi.stubEnv("APPLE_PAY_DOMAIN_ASSOCIATION", "  7B2270737049643A  ");

    const response = GET();

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("7B2270737049643A");
  });

  it("returns 404 when no association file is configured", () => {
    vi.stubEnv("APPLE_PAY_DOMAIN_ASSOCIATION", "");

    expect(GET().status).toBe(404);
  });
});
