import { beforeEach, describe, expect, it, vi } from "vitest";
import { recentlyViewedApi } from "./api";

const { authenticatedJsonMock, optionalAuthJsonMock } = vi.hoisted(() => ({
  authenticatedJsonMock: vi.fn(),
  optionalAuthJsonMock: vi.fn(),
}));

vi.mock("@/lib/api/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/client")>(
      "@/lib/api/client",
    );

  return {
    ...actual,
    authenticatedJson: authenticatedJsonMock,
    optionalAuthJson: optionalAuthJsonMock,
  };
});

describe("recentlyViewedApi", () => {
  beforeEach(() => {
    authenticatedJsonMock.mockResolvedValue({
      postings: [],
      trackingEnabled: true,
    });
    optionalAuthJsonMock.mockResolvedValue({ accepted: true });
  });

  it("records a view against the activity route with optional auth", async () => {
    await recentlyViewedApi.recordView("posting-1");

    expect(optionalAuthJsonMock).toHaveBeenCalledWith(
      "POST",
      "/postings/posting-1/activity/view",
    );
  });

  it("encodes the posting identifier", async () => {
    await recentlyViewedApi.recordView("a/b c");

    expect(optionalAuthJsonMock).toHaveBeenCalledWith(
      "POST",
      "/postings/a%2Fb%20c/activity/view",
    );
  });

  // Fire-and-forget: a lost view must never surface to the visitor, and must
  // never reject into an unhandled promise. It still reports failure via its
  // return value, though, so the provider can tell whether it is safe to
  // refresh from the account.
  it("swallows a failed view recording, reporting it as not accepted", async () => {
    optionalAuthJsonMock.mockRejectedValue(new Error("offline"));

    await expect(recentlyViewedApi.recordView("posting-1")).resolves.toBe(
      false,
    );
  });

  it("reports a successful view recording as accepted", async () => {
    await expect(recentlyViewedApi.recordView("posting-1")).resolves.toBe(true);
  });

  it("lists with the default limit", async () => {
    await recentlyViewedApi.list();

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "GET",
      "/postings/recently-viewed?limit=24",
      undefined,
      undefined,
      undefined,
    );
  });

  it("lists with an explicit limit", async () => {
    await recentlyViewedApi.list({ limit: 8 });

    expect(authenticatedJsonMock.mock.calls[0][1]).toBe(
      "/postings/recently-viewed?limit=8",
    );
  });

  it("syncs entries as a body", async () => {
    await recentlyViewedApi.sync([
      { postingId: "posting-1", viewedAt: "2026-09-01T00:00:00.000Z" },
    ]);

    const [method, path, body] = authenticatedJsonMock.mock.calls[0];

    expect(method).toBe("POST");
    expect(path).toBe("/postings/recently-viewed/sync?limit=24");
    expect(body).toEqual({
      entries: [
        { postingId: "posting-1", viewedAt: "2026-09-01T00:00:00.000Z" },
      ],
    });
  });

  it("trims a sync batch to the server limit", async () => {
    const entries = Array.from({ length: 60 }, (_unused, index) => ({
      postingId: `posting-${index}`,
      viewedAt: "2026-09-01T00:00:00.000Z",
    }));

    await recentlyViewedApi.sync(entries);

    expect(authenticatedJsonMock.mock.calls[0][2].entries).toHaveLength(50);
  });

  it("clears the whole history", async () => {
    await recentlyViewedApi.clear();

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "DELETE",
      "/postings/recently-viewed",
    );
  });

  it("removes one entry", async () => {
    await recentlyViewedApi.remove("posting-1");

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "DELETE",
      "/postings/recently-viewed/posting-1",
    );
  });
});
