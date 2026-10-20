import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticatedJsonMock } = vi.hoisted(() => ({
  authenticatedJsonMock: vi.fn(),
}));

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  authenticatedJson: authenticatedJsonMock,
}));

const { securityActivityApi } = await import("@/lib/security-activity/api");

describe("securityActivityApi.listMine", () => {
  beforeEach(() => {
    authenticatedJsonMock.mockReset();
    authenticatedJsonMock.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("reads the first page without query parameters", async () => {
    await expect(securityActivityApi.listMine()).resolves.toEqual({
      items: [],
      nextCursor: null,
    });

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "GET",
      "/auth/audit/me",
      undefined,
      undefined,
      undefined,
    );
  });

  it("passes the cursor, limit and category, and forwards the abort signal", async () => {
    const controller = new AbortController();

    await securityActivityApi.listMine(
      {
        cursor: "abc_-",
        limit: 10,
        category: "security_changes",
        from: "2026-10-01T04:00:00.000Z",
        to: "2026-10-08T04:00:00.000Z",
      },
      controller.signal,
    );

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "GET",
      "/auth/audit/me?cursor=abc_-&limit=10&category=security_changes&from=2026-10-01T04%3A00%3A00.000Z&to=2026-10-08T04%3A00%3A00.000Z",
      undefined,
      undefined,
      controller.signal,
    );
  });
});
