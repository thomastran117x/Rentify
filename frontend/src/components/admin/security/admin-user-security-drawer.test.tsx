import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, ApiServerError } from "@/lib/api/types";
import type { AdminUserSecuritySummary } from "@/lib/admin-security/types";

const { getUserSummaryMock } = vi.hoisted(() => ({
  getUserSummaryMock: vi.fn(),
}));

vi.mock("@/lib/admin-security/api", () => ({
  adminSecurityApi: { getUserSummary: getUserSummaryMock },
}));

const { AdminUserSecurityDrawer } = await import(
  "@/components/admin/security/admin-user-security-drawer"
);

const REQUEST = {
  method: "GET",
  path: "/admin/users/user-1/security",
  requestUrl: "http://localhost:8040/api/v1/admin/users/user-1/security",
};

const USER = {
  id: "user-1",
  email: "user1@rentify.local",
  username: "renter-one",
};

function summary(
  overrides: Partial<AdminUserSecuritySummary> = {},
): AdminUserSecuritySummary {
  return {
    user: { ...USER, role: "user" },
    accountStatus: "active",
    lastLoginAt: null,
    failedSignIns: { last24Hours: 0, last7Days: 0 },
    lockout: {
      locked: false,
      failedAttempts: 0,
      lockedAt: null,
      lockedUntil: null,
    },
    devices: [],
    recentEvents: [],
    ...overrides,
  };
}

function clientError(status: number) {
  return new ApiClientError("Request failed.", {
    code: status === 404 ? "RESOURCE_NOT_FOUND" : "FORBIDDEN",
    status,
    request: REQUEST,
  });
}

function renderDrawer() {
  const onClose = vi.fn();
  const onShowEvents = vi.fn();

  render(
    <>
      <button type="button">Opener</button>
      <AdminUserSecurityDrawer
        user={USER}
        onClose={onClose}
        onShowEvents={onShowEvents}
      />
    </>,
  );

  return { onClose, onShowEvents };
}

describe("AdminUserSecurityDrawer", () => {
  beforeEach(() => {
    getUserSummaryMock.mockReset();
  });

  it("shows the summary with devices and recent events", async () => {
    getUserSummaryMock.mockResolvedValueOnce(
      summary({
        lastLoginAt: "2026-10-17T09:00:00.000Z",
        failedSignIns: { last24Hours: 2, last7Days: 3 },
        lockout: {
          locked: false,
          failedAttempts: 2,
          lockedAt: null,
          lockedUntil: null,
        },
        devices: [
          {
            id: "d-1",
            deviceId: "laptop",
            type: "desktop",
            platform: "Windows",
            browser: "Chrome",
            os: "Windows",
            lastIpAddress: "203.0.113.7",
            firstSeenAt: "2026-09-01T00:00:00.000Z",
            lastSeenAt: "2026-10-17T09:00:00.000Z",
          },
          {
            id: "d-2",
            deviceId: "phone",
            type: "mobile",
            platform: null,
            browser: null,
            os: null,
            lastIpAddress: null,
            firstSeenAt: "2026-09-01T00:00:00.000Z",
            lastSeenAt: "2026-09-02T00:00:00.000Z",
          },
        ],
        recentEvents: [
          {
            id: "event-1",
            eventType: "login.failed",
            outcome: "failure",
            reasonCode: "bad_credentials",
            method: "password",
            ipAddress: "203.0.113.7",
            userAgent: null,
            browser: null,
            os: null,
            deviceId: null,
            sessionId: null,
            requestId: null,
            metadata: null,
            occurredAt: "2026-10-18T11:00:00.000Z",
            subject: USER,
            actor: null,
          },
        ],
      }),
    );

    renderDrawer();

    expect(
      screen.getByRole("status", { name: "Loading account security" }),
    ).toBeInTheDocument();

    const dialog = await screen.findByRole("dialog", { name: "renter-one" });
    expect(await within(dialog).findByText("Not locked")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "2 recent failed attempts; the account locks at 5.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("active")).toBeInTheDocument();
    expect(within(dialog).getByText("Chrome on Windows")).toBeInTheDocument();
    expect(within(dialog).getByText("mobile")).toBeInTheDocument();
    expect(within(dialog).getByText(/from 203\.0\.113\.7/)).toBeInTheDocument();
    expect(within(dialog).getByText("Sign-in failed")).toBeInTheDocument();
    expect(within(dialog).getByText("Failed")).toBeInTheDocument();
  });

  it("describes an account with no failures, devices or events", async () => {
    getUserSummaryMock.mockResolvedValueOnce(summary());

    renderDrawer();

    expect(
      await screen.findByText("No recent failed password attempts."),
    ).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
    expect(screen.getByText("No registered devices.")).toBeInTheDocument();
    expect(
      screen.getByText("No events in the last 90 days."),
    ).toBeInTheDocument();
  });

  it("lists the first five devices and expands to all of them", async () => {
    const user = userEvent.setup();
    getUserSummaryMock.mockResolvedValueOnce(
      summary({
        devices: Array.from({ length: 7 }, (_, index) => ({
          id: `d-${index}`,
          deviceId: `device-${index}`,
          type: "desktop",
          platform: `Platform ${index}`,
          browser: null,
          os: null,
          lastIpAddress: null,
          firstSeenAt: "2026-09-01T00:00:00.000Z",
          lastSeenAt: "2026-09-02T00:00:00.000Z",
        })),
      }),
    );

    renderDrawer();

    expect(
      await screen.findByText("Registered devices (7)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Platform 4")).toBeInTheDocument();
    expect(screen.queryByText("Platform 5")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Show all 7 devices" }),
    );
    expect(screen.getByText("Platform 6")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Show fewer devices" }),
    );
    expect(screen.queryByText("Platform 6")).not.toBeInTheDocument();
  });

  it("shows when a lock ends", async () => {
    getUserSummaryMock.mockResolvedValueOnce(
      summary({
        lockout: {
          locked: true,
          failedAttempts: 5,
          lockedAt: "2026-10-18T11:50:00.000Z",
          lockedUntil: "2026-10-18T12:20:00.000Z",
        },
      }),
    );

    renderDrawer();

    expect(
      await screen.findByText("Password sign-in is locked"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Locked after 5 failed attempts, until/),
    ).toBeInTheDocument();
  });

  it.each([
    [404, "This account no longer exists."],
    [403, "You no longer have access to account security details."],
  ])("explains a %s without offering a retry", async (status, message) => {
    getUserSummaryMock.mockRejectedValueOnce(clientError(status));

    renderDrawer();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("retries after a server error", async () => {
    const user = userEvent.setup();
    getUserSummaryMock
      .mockRejectedValueOnce(
        new ApiServerError("Server error", {
          code: "INTERNAL",
          status: 500,
          request: REQUEST,
        }),
      )
      .mockResolvedValueOnce(summary());

    renderDrawer();

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Not locked")).toBeInTheDocument();
    expect(getUserSummaryMock).toHaveBeenCalledTimes(2);
  });

  it("closes with Escape, the close button and the backdrop, and keeps Tab inside", async () => {
    const user = userEvent.setup();
    getUserSummaryMock.mockResolvedValue(summary());

    const { onClose, onShowEvents } = renderDrawer();
    await screen.findByText("Not locked");

    const close = screen.getByRole("button", {
      name: "Close account security",
    });
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "Show all events" }),
    ).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    await user.click(close);
    await user.click(
      screen.getByRole("dialog").previousElementSibling as HTMLElement,
    );
    expect(onClose).toHaveBeenCalledTimes(3);

    await user.click(screen.getByRole("button", { name: "Show all events" }));
    expect(onShowEvents).toHaveBeenCalledWith(USER);
  });
});
