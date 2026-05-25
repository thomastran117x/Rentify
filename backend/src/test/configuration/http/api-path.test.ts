import {
  API_ROUTE_PREFIX,
  buildApiPath,
  getApiVersion,
  stripApiRoutePrefix,
} from "@/configuration/http/api-path";

describe("api-path", () => {
  it("builds versioned API paths from relative route paths", () => {
    expect(getApiVersion()).toBe("v1");
    expect(API_ROUTE_PREFIX).toBe("/api/v1");
    expect(buildApiPath()).toBe("/api/v1");
    expect(buildApiPath("/postings")).toBe("/api/v1/postings");
    expect(buildApiPath("auth/local/login")).toBe("/api/v1/auth/local/login");
  });

  it("strips the API route prefix for policy-level path matching", () => {
    expect(stripApiRoutePrefix("/api/v1")).toBe("/");
    expect(stripApiRoutePrefix("/api/v1/postings/post-1")).toBe(
      "/postings/post-1",
    );
    expect(stripApiRoutePrefix("/postings/post-1")).toBe("/postings/post-1");
  });
});
