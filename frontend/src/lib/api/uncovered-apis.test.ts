import { beforeEach, describe, expect, it, vi } from "vitest";
import { systemApi } from "../system/api";
import { savedPostingsApi } from "../saved-postings/api";
import { profilesApi } from "../profiles/api";
import { blobApi } from "../blob/api";
import { feedbackApi } from "../feedback/api";
import { adminFeatureFlagsApi } from "../admin-feature-flags/api";
import { adminSearchApi } from "../admin-search/api";
import { personalAccessTokensApi } from "../personal-access-tokens/api";

const { authenticatedJsonMock, optionalAuthJsonMock, publicJsonMock, textRequestMock, buildPathMock, readSessionMock, baseUrlMock } = vi.hoisted(() => ({
  authenticatedJsonMock: vi.fn(), optionalAuthJsonMock: vi.fn(), publicJsonMock: vi.fn(), textRequestMock: vi.fn(), buildPathMock: vi.fn((path: string, query: Record<string, unknown>) => `${path}?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()}`),
  readSessionMock: vi.fn(), baseUrlMock: vi.fn(() => "https://api.example.test/api/v1"),
}));

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: authenticatedJsonMock,
  optionalAuthJson: optionalAuthJsonMock,
  publicJson: publicJsonMock,
  textRequest: textRequestMock,
  buildPathWithQuery: buildPathMock,
}));
vi.mock("@/lib/auth/storage", () => ({ readStoredSession: readSessionMock }));
vi.mock("@/lib/env", () => ({ resolveApiBaseUrl: baseUrlMock }));

describe("previously uncovered API helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildPathMock.mockImplementation((path: string, query: Record<string, unknown>) => `${path}?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()}`);
  });

  it("uses public endpoints for system health and profile listing", () => {
    systemApi.getRoot();
    systemApi.getHealth();
    systemApi.getOpenApiYaml();
    profilesApi.list({ page: 2, pageSize: 50, q: "alex" });

    expect(publicJsonMock).toHaveBeenNthCalledWith(1, "GET", "/");
    expect(publicJsonMock).toHaveBeenNthCalledWith(2, "GET", "/health");
    expect(textRequestMock).toHaveBeenCalledWith("/openapi.yaml");
    expect(publicJsonMock).toHaveBeenLastCalledWith("GET", "/profiles?page=2&pageSize=50&q=alex");
  });

  it("uses default pagination and encoded paths for saved postings", () => {
    savedPostingsApi.save("posting / 1");
    savedPostingsApi.unsave("posting / 1");
    savedPostingsApi.list();
    const signal = new AbortController().signal;
    savedPostingsApi.listIds(signal);

    expect(authenticatedJsonMock).toHaveBeenNthCalledWith(1, "POST", "/postings/posting%20%2F%201/save");
    expect(authenticatedJsonMock).toHaveBeenNthCalledWith(2, "DELETE", "/postings/posting%20%2F%201/save");
    expect(authenticatedJsonMock).toHaveBeenNthCalledWith(3, "GET", "/postings/saved?page=1&pageSize=20");
    expect(authenticatedJsonMock).toHaveBeenNthCalledWith(4, "GET", "/postings/saved/ids", undefined, undefined, signal);
  });

  it("gets and updates the current profile and creates or deletes blobs", async () => {
    profilesApi.getMine();
    profilesApi.updateMine({ username: "alex", isPrivate: true });
    blobApi.createUploadUrl({ filename: "photo.png", contentType: "image/png", scope: "profile" });
    await blobApi.deleteBlob("photo.png");

    expect(authenticatedJsonMock).toHaveBeenNthCalledWith(1, "GET", "/profile/me");
    expect(authenticatedJsonMock).toHaveBeenNthCalledWith(2, "PUT", "/profile/me", { username: "alex", isPrivate: true });
    expect(authenticatedJsonMock).toHaveBeenNthCalledWith(3, "POST", "/blob/upload-url", { filename: "photo.png", contentType: "image/png", scope: "profile" });
    expect(authenticatedJsonMock).toHaveBeenNthCalledWith(4, "DELETE", "/blob?blobName=photo.png");
  });

  it("only sends keepalive deletes when a browser session has an access token", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    readSessionMock.mockReturnValue(null);
    blobApi.deleteBlobKeepalive("one");
    expect(fetchMock).not.toHaveBeenCalled();

    readSessionMock.mockReturnValue({ accessToken: "token" });
    blobApi.deleteBlobKeepalive("one");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/v1/blob?blobName=one", expect.objectContaining({ method: "DELETE", keepalive: true }));
  });

  it("delegates feedback, feature flag, search administration, and token requests", () => {
    feedbackApi.create({ name: "Alex", email: "alex@example.com", category: "bug_report", message: "Broken" });
    adminFeatureFlagsApi.list();
    adminFeatureFlagsApi.set("Search Beta", { enabled: true });
    adminFeatureFlagsApi.delete("Search Beta");
    adminSearchApi.startReindex();
    adminSearchApi.getReindexRun("run / 1");
    adminSearchApi.getStatus();
    adminSearchApi.replayDeadLetteredOutbox();
    adminSearchApi.cleanupRetainedIndices();
    personalAccessTokensApi.list();
    personalAccessTokensApi.create({ name: "CLI", expiresInDays: 30, scopes: ["mcp:read"] });
    personalAccessTokensApi.revoke("token / 1");

    expect(optionalAuthJsonMock).toHaveBeenCalledWith("POST", "/feedback", expect.objectContaining({ category: "bug_report" }));
    expect(authenticatedJsonMock).toHaveBeenCalledWith("PUT", "/admin/feature-flags/search%20beta", { enabled: true });
    expect(authenticatedJsonMock).toHaveBeenCalledWith("DELETE", "/admin/feature-flags/search%20beta");
    expect(authenticatedJsonMock).toHaveBeenCalledWith("GET", "/admin/search/reindex/run%20%2F%201");
    expect(authenticatedJsonMock).toHaveBeenCalledWith("POST", "/admin/search/outbox/replay-dead-lettered", {});
    expect(authenticatedJsonMock).toHaveBeenCalledWith("POST", "/admin/search/cleanup-retained-indices", {});
    expect(authenticatedJsonMock).toHaveBeenCalledWith("DELETE", "/auth/personal-access-tokens/token%20%2F%201");
  });
});
