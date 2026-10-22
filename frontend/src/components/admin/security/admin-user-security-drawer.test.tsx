import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, ApiServerError } from "@/lib/api/types";
import type { AdminUserSecuritySummary } from "@/lib/admin-security/types";

const { getUserSummaryMock, changeAccountStatusMock } = vi.hoisted(() => ({
  getUserSummaryMock: vi.fn(),
  changeAccountStatusMock: vi.fn(),
}));

vi.mock("@/lib/admin-security/api", () => ({
  adminSecurityApi: {
    getUserSummary: getUserSummaryMock,
    changeAccountStatus: changeAccountStatusMock,
  },
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
    accountStatusChange: null,
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

function renderDrawer(viewerId: string | null = "admin-1") {
  const onClose = vi.fn();
  const onShowEvents = vi.fn();
  const onStatusChanged = vi.fn();

  render(
    <>
      <button type="button">Opener</button>
      <AdminUserSecurityDrawer
        user={USER}
        viewerId={viewerId}
        onClose={onClose}
        onShowEvents={onShowEvents}
        onStatusChanged={onStatusChanged}
      />
    </>,
  );

  return { onClose, onShowEvents, onStatusChanged };
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
    expect(
      await within(dialog).findByText("Password sign-in is not locked"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "2 recent failed attempts; the account locks at 5.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Active")).toBeInTheDocument();
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

    expect(
      await screen.findByText("Password sign-in is not locked"),
    ).toBeInTheDocument();
    expect(getUserSummaryMock).toHaveBeenCalledTimes(2);
  });

  it("closes with Escape, the close button and the backdrop, and keeps Tab inside", async () => {
    const user = userEvent.setup();
    getUserSummaryMock.mockResolvedValue(summary());

    const { onClose, onShowEvents } = renderDrawer();
    await screen.findByText("Password sign-in is not locked");

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

describe("AdminUserSecurityDrawer account status actions", () => {
  const REASON = "Reported account takeover";

  beforeEach(() => {
    getUserSummaryMock.mockReset();
    changeAccountStatusMock.mockReset();
  });

  function statusResult(status: "active" | "locked" | "suspended") {
    return {
      userId: USER.id,
      status,
      statusReason: REASON,
      statusChangedAt: "2026-10-21T09:00:00.000Z",
      statusChangedBy: "admin-1",
      changed: true,
    };
  }

  function actionLabels(panel: HTMLElement): Array<string | null> {
    return within(panel)
      .queryAllByRole("button")
      .map((button) => button.textContent);
  }

  it("offers a hold and a suspension for an active account", async () => {
    getUserSummaryMock.mockResolvedValueOnce(summary());
    renderDrawer();

    const panel = await screen.findByRole("region", { name: "Account status" });

    expect(
      within(panel).getByText("The status has never been changed."),
    ).toBeInTheDocument();
    expect(actionLabels(panel)).toEqual(["Place security hold", "Suspend"]);
  });

  it("validates the reason, disables the dialog while saving, then refreshes the summary", async () => {
    const user = userEvent.setup();
    getUserSummaryMock.mockResolvedValueOnce(summary()).mockResolvedValueOnce(
      summary({
        accountStatus: "locked",
        accountStatusChange: {
          reason: REASON,
          changedAt: "2026-10-21T09:00:00.000Z",
          changedBy: {
            id: "admin-1",
            email: "admin1@rentify.local",
            username: "admin-one",
          },
        },
      }),
    );
    let resolveChange: (value: unknown) => void = () => undefined;
    changeAccountStatusMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveChange = resolve;
      }),
    );
    const { onClose, onStatusChanged } = renderDrawer();

    await user.click(
      await screen.findByRole("button", { name: "Place security hold" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Put on a security hold",
    });
    const reason = within(dialog).getByLabelText("Reason");
    expect(reason).toHaveFocus();

    await user.type(reason, " no ");
    await user.click(
      within(dialog).getByRole("button", { name: "Place security hold" }),
    );
    expect(
      within(dialog).getByText("Give a reason of at least 5 characters."),
    ).toBeInTheDocument();
    expect(changeAccountStatusMock).not.toHaveBeenCalled();

    await user.clear(reason);
    await user.type(reason, "  " + REASON + " ");
    await user.click(
      within(dialog).getByRole("button", { name: "Place security hold" }),
    );

    expect(changeAccountStatusMock).toHaveBeenCalledWith(
      USER.id,
      "lock",
      REASON,
    );
    expect(
      within(dialog).getByRole("button", { name: "Placing hold..." }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();

    let resolveRefresh: (value: unknown) => void = () => undefined;
    getUserSummaryMock.mockReset();
    getUserSummaryMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    resolveChange(statusResult("locked"));

    // Until the refreshed summary arrives, the old status's actions are off.
    expect(
      await screen.findByText(
        "Security hold placed. The account's sessions and access tokens have ended.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suspend" })).toBeDisabled();

    resolveRefresh(
      summary({
        accountStatus: "locked",
        accountStatusChange: {
          reason: REASON,
          changedAt: "2026-10-21T09:00:00.000Z",
          changedBy: {
            id: "admin-1",
            email: "admin1@rentify.local",
            username: "admin-one",
          },
        },
      }),
    );

    expect(
      await screen.findByText(
        "Security hold placed. The account's sessions and access tokens have ended.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Put on a security hold" }),
    ).toBeNull();
    expect(await screen.findByText("Security hold")).toBeInTheDocument();
    expect(screen.getByText(REASON)).toBeInTheDocument();
    expect(screen.getByText(/by admin-one/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reinstate" })).toBeEnabled();
    expect(getUserSummaryMock).toHaveBeenCalledTimes(1);
    expect(onStatusChanged).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the API's reason when the change is refused", async () => {
    const user = userEvent.setup();
    getUserSummaryMock.mockResolvedValueOnce(
      summary({ accountStatus: "locked" }),
    );
    changeAccountStatusMock.mockRejectedValueOnce(
      new ApiClientError("You cannot change your own account status.", {
        code: "FORBIDDEN",
        status: 403,
        request: REQUEST,
      }),
    );
    renderDrawer();

    await user.click(await screen.findByRole("button", { name: "Suspend" }));
    const dialog = screen.getByRole("dialog", { name: "Suspend account" });
    await user.type(within(dialog).getByLabelText("Reason"), REASON);
    await user.click(
      within(dialog).getByRole("button", { name: "Suspend account" }),
    );

    expect(
      await within(dialog).findByText(
        "You cannot change your own account status.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Suspend account" }),
    ).toBeEnabled();
  });

  it("shows a 400's field message under the reason", async () => {
    const user = userEvent.setup();
    getUserSummaryMock.mockResolvedValueOnce(
      summary({ accountStatus: "suspended" }),
    );
    changeAccountStatusMock.mockRejectedValueOnce(
      new ApiClientError("Request body validation failed.", {
        code: "VALIDATION_ERROR",
        status: 400,
        details: { reason: ["Reason must be at most 255 characters."] },
        request: REQUEST,
      }),
    );
    renderDrawer();

    await user.click(await screen.findByRole("button", { name: "Reinstate" }));
    const dialog = screen.getByRole("dialog", { name: "Reinstate account" });
    await user.type(within(dialog).getByLabelText("Reason"), REASON);
    await user.click(
      within(dialog).getByRole("button", { name: "Reinstate account" }),
    );

    expect(
      await within(dialog).findByText("Reason must be at most 255 characters."),
    ).toBeInTheDocument();
  });

  it("says when a reinstated account was already active", async () => {
    const user = userEvent.setup();
    getUserSummaryMock
      .mockResolvedValueOnce(summary({ accountStatus: "locked" }))
      .mockResolvedValueOnce(summary());
    changeAccountStatusMock.mockResolvedValueOnce({
      ...statusResult("active"),
      changed: false,
    });
    renderDrawer();

    await user.click(await screen.findByRole("button", { name: "Reinstate" }));
    const dialog = screen.getByRole("dialog", { name: "Reinstate account" });
    await user.type(within(dialog).getByLabelText("Reason"), REASON);
    await user.click(
      within(dialog).getByRole("button", { name: "Reinstate account" }),
    );

    expect(
      await screen.findByText("The account was already active."),
    ).toBeInTheDocument();
  });

  it("closes only the dialog on Escape and returns focus to the action", async () => {
    const user = userEvent.setup();
    getUserSummaryMock.mockResolvedValueOnce(summary());
    const { onClose } = renderDrawer();

    const trigger = await screen.findByRole("button", { name: "Suspend" });
    await user.click(trigger);
    expect(
      screen.getByRole("dialog", { name: "Suspend account" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "Suspend account" }),
    ).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("offers only reinstatement for a suspended account and says who acted", async () => {
    getUserSummaryMock.mockResolvedValueOnce(
      summary({
        accountStatus: "suspended",
        accountStatusChange: {
          reason: null,
          changedAt: "2026-10-21T09:00:00.000Z",
          changedBy: null,
        },
      }),
    );
    renderDrawer();

    const panel = await screen.findByRole("region", { name: "Account status" });

    expect(within(panel).getByText("No reason recorded.")).toBeInTheDocument();
    expect(
      within(panel).getByText(/by the user or the system/),
    ).toBeInTheDocument();
    expect(actionLabels(panel)).toEqual(["Reinstate"]);
  });

  it("hides the actions on the admin's own account", async () => {
    getUserSummaryMock.mockResolvedValueOnce(summary());
    renderDrawer(USER.id);

    const panel = await screen.findByRole("region", { name: "Account status" });

    expect(actionLabels(panel)).toEqual([]);
    expect(
      within(panel).getByText(
        "You can't change the status of your own account.",
      ),
    ).toBeInTheDocument();
  });
});
