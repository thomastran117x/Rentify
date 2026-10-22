import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticatedJsonMock } = vi.hoisted(() => ({
  authenticatedJsonMock: vi.fn(),
}));

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  authenticatedJson: authenticatedJsonMock,
}));

const { adminSecurityApi } = await import("@/lib/admin-security/api");

describe("adminSecurityApi", () => {
  beforeEach(() => {
    authenticatedJsonMock.mockReset();
    authenticatedJsonMock.mockResolvedValue({});
  });

  it("searches without query parameters by default", async () => {
    await adminSecurityApi.listEvents();

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "GET",
      "/admin/auth/audit",
      undefined,
      undefined,
      undefined,
    );
  });

  it("repeats eventType, sends every filter and forwards the abort signal", async () => {
    const controller = new AbortController();

    await adminSecurityApi.listEvents(
      {
        user: "user1@rentify.local",
        ip: "203.0.113.7",
        eventType: ["login.failed", "login.locked"],
        outcome: "failure",
        from: "2026-10-01T04:00:00.000Z",
        to: "2026-10-08T04:00:00.000Z",
        cursor: "abc",
        limit: 25,
      },
      controller.signal,
    );

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "GET",
      "/admin/auth/audit?user=user1%40rentify.local&ip=203.0.113.7&eventType=login.failed&eventType=login.locked&outcome=failure&from=2026-10-01T04%3A00%3A00.000Z&to=2026-10-08T04%3A00%3A00.000Z&cursor=abc&limit=25",
      undefined,
      undefined,
      controller.signal,
    );
  });

  it("reads one account's security summary", async () => {
    const controller = new AbortController();

    await adminSecurityApi.getUserSummary("user/1", controller.signal);

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "GET",
      "/admin/users/user%2F1/security",
      undefined,
      undefined,
      controller.signal,
    );
  });

  it.each(["lock", "suspend", "reinstate"] as const)(
    "posts the reason to %s an account",
    async (action) => {
      await adminSecurityApi.changeAccountStatus(
        "user/1",
        action,
        "Reported account takeover",
      );

      expect(authenticatedJsonMock).toHaveBeenCalledWith(
        "POST",
        "/admin/users/user%2F1/" + action,
        { reason: "Reported account takeover" },
      );
    },
  );
});
