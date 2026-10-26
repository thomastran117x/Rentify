import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, ApiServerError } from "@/lib/api/types";
import type {
  AdminAuthAuditEvent,
  AdminAuthAuditEventList,
  AdminUserSecuritySummary,
} from "@/lib/admin-security/types";
import { resetRouterMocks, routerPushMock } from "@/test/mocks/next-navigation";

const { listEventsMock, getUserSummaryMock, searchParamsRef } = vi.hoisted(
  () => ({
    listEventsMock: vi.fn(),
    getUserSummaryMock: vi.fn(),
    searchParamsRef: { current: new URLSearchParams() },
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  usePathname: () => "/admin/security",
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "admin-1" } } }),
}));

vi.mock("@/lib/admin-security/api", () => ({
  adminSecurityApi: {
    listEvents: listEventsMock,
    getUserSummary: getUserSummaryMock,
  },
}));

const { AdminSecurityWorkspace } = await import(
  "@/components/admin/security/admin-security-workspace"
);

const REQUEST = {
  method: "GET",
  path: "/admin/auth/audit",
  requestUrl: "http://localhost:8040/api/v1/admin/auth/audit",
};

const RENTER = {
  id: "user-1",
  email: "user1@rentify.local",
  username: "renter-one",
};

function event(
  overrides: Partial<AdminAuthAuditEvent> = {},
): AdminAuthAuditEvent {
  return {
    id: "event-1",
    eventType: "login.failed",
    outcome: "failure",
    reasonCode: "bad_credentials",
    method: "password",
    ipAddress: "203.0.113.7",
    userAgent: "Mozilla/5.0 Chrome",
    browser: "Chrome",
    os: "Windows",
    deviceId: "device-1",
    sessionId: null,
    requestId: "request-1",
    metadata: null,
    flagged: false,
    occurredAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    subject: RENTER,
    actor: null,
    ...overrides,
  };
}

function page(
  items: AdminAuthAuditEvent[],
  nextCursor: string | null = null,
): AdminAuthAuditEventList {
  return {
    items,
    nextCursor,
    range: {
      from: "2026-10-11T12:00:00.000Z",
      to: "2026-10-18T12:00:00.000Z",
    },
  };
}

function summary(): AdminUserSecuritySummary {
  return {
    user: { ...RENTER, role: "user" },
    accountStatus: "active",
    accountStatusChange: null,
    lastLoginAt: "2026-10-17T09:00:00.000Z",
    failedSignIns: { last24Hours: 5, last7Days: 6 },
    lockout: {
      locked: true,
      failedAttempts: 5,
      lockedAt: "2026-10-18T11:50:00.000Z",
      lockedUntil: "2026-10-18T12:20:00.000Z",
    },
    devices: [],
    recentEvents: [],
  };
}

function clientError(status: number, details?: unknown) {
  return new ApiClientError("Request failed.", {
    code: status === 403 ? "FORBIDDEN" : "VALIDATION_ERROR",
    status,
    details,
    request: REQUEST,
  });
}

function table() {
  return screen.getByRole("table", { name: "Sign-in activity" });
}

describe("AdminSecurityWorkspace", () => {
  beforeEach(() => {
    resetRouterMocks();
    listEventsMock.mockReset();
    getUserSummaryMock.mockReset();
    searchParamsRef.current = new URLSearchParams();
  });

  it("shows a loading state, then the events with outcome badges", async () => {
    let resolve!: (value: AdminAuthAuditEventList) => void;
    listEventsMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );

    render(<AdminSecurityWorkspace />);

    expect(
      screen.getByRole("status", { name: "Loading sign-in activity" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply filters" }),
    ).toBeDisabled();

    resolve(
      page([
        event(),
        event({
          id: "event-2",
          eventType: "login.locked",
          outcome: "blocked",
          subject: null,
          userAgent: null,
        }),
        event({
          id: "event-3",
          eventType: "admin.audit_viewed",
          outcome: "success",
          subject: null,
          actor: {
            id: "admin-1",
            email: "admin1@rentify.local",
            username: "admin-one",
          },
        }),
      ]),
    );

    const rows = within(await screen.findByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText("Sign-in failed")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Failed")).toBeInTheDocument();
    expect(
      within(rows[1]!).getByText("login.failed · bad_credentials"),
    ).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Chrome on Windows")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Blocked")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("unknown")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Audit log viewed")).toBeInTheDocument();
    expect(within(rows[3]!).queryByText("unknown")).not.toBeInTheDocument();
    expect(within(rows[3]!).getByText("admin-one")).toBeInTheDocument();
    expect(screen.getByText(/\(last 7 days\)/)).toBeInTheDocument();
    expect(listEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, cursor: undefined }),
      expect.any(AbortSignal),
    );
  });

  it("searches with the filters in the URL", async () => {
    searchParamsRef.current = new URLSearchParams(
      "user=renter-one&eventType=login.failed&eventType=login.locked&outcome=failure&flagged=true&from=2026-10-01&to=2026-10-08",
    );
    listEventsMock.mockResolvedValueOnce(page([event({ flagged: true })]));

    render(<AdminSecurityWorkspace />);

    await screen.findByRole("table");
    expect(listEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "renter-one",
        eventType: ["login.failed", "login.locked"],
        outcome: "failure",
        flagged: true,
        from: expect.any(String),
        to: expect.any(String),
      }),
      expect.any(AbortSignal),
    );
    expect(screen.getByLabelText("User")).toHaveValue("renter-one");
    expect(screen.getByLabelText("Flagged only")).toBeChecked();
    expect(screen.getByText("Flagged")).toBeInTheDocument();
    expect(screen.getByText("2 event types")).toBeInTheDocument();
    expect(screen.queryByText(/\(last 7 days\)/)).not.toBeInTheDocument();
  });

  it("applies the filter bar to the URL", async () => {
    const user = userEvent.setup();
    listEventsMock.mockResolvedValue(page([]));

    render(<AdminSecurityWorkspace />);
    await screen.findByText("No events match these filters.");

    await user.type(screen.getByLabelText("User"), "user1@rentify.local");
    await user.type(screen.getByLabelText("IP address"), "203.0.113.7");
    await user.selectOptions(screen.getByLabelText("Outcome"), "blocked");
    await user.click(screen.getByLabelText("Flagged only"));
    await user.click(screen.getByText("All event types"));
    await user.click(screen.getByLabelText("Account locked"));
    await user.click(screen.getByLabelText("Sign-in failed"));
    expect(screen.getByText("2 event types")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Sign-in failed"));
    expect(
      screen.getByText("Account locked", { selector: "span" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(routerPushMock).toHaveBeenCalledWith(
      "/admin/security?user=user1%40rentify.local&ip=203.0.113.7&eventType=login.locked&outcome=blocked&flagged=true",
      { scroll: false },
    );
  });

  it("flags a To date before From and does not search", async () => {
    const user = userEvent.setup();
    listEventsMock.mockResolvedValue(page([]));

    render(<AdminSecurityWorkspace />);
    await screen.findByText("No events match these filters.");

    await user.type(screen.getByLabelText("From"), "2026-10-08");
    await user.type(screen.getByLabelText("To"), "2026-10-01");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The To date must be on or after the From date.",
    );
    expect(
      screen.getByRole("button", { name: "Apply filters" }),
    ).toBeDisabled();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("clears every filter at once", async () => {
    const user = userEvent.setup();
    searchParamsRef.current = new URLSearchParams("ip=203.0.113.7");
    listEventsMock.mockResolvedValue(page([]));

    render(<AdminSecurityWorkspace />);
    await screen.findByText("No events match these filters.");
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(routerPushMock).toHaveBeenCalledWith("/admin/security", {
      scroll: false,
    });
  });

  it("pivots from a row to every account seen from its IP", async () => {
    const user = userEvent.setup();
    searchParamsRef.current = new URLSearchParams(
      "user=renter-one&outcome=failure",
    );
    listEventsMock.mockResolvedValue(page([event()]));

    render(<AdminSecurityWorkspace />);
    await user.click(
      await screen.findByRole("button", {
        name: "Filter by IP address 203.0.113.7",
      }),
    );

    expect(routerPushMock).toHaveBeenCalledWith(
      "/admin/security?ip=203.0.113.7&outcome=failure",
      { scroll: false },
    );
  });

  it("pages older and back to newer with the cursor", async () => {
    const user = userEvent.setup();
    listEventsMock
      .mockResolvedValueOnce(page([event()], "cursor-2"))
      .mockResolvedValueOnce(page([event({ id: "event-9" })], null))
      .mockResolvedValueOnce(page([event()], "cursor-2"));

    render(<AdminSecurityWorkspace />);
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Newer" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Older" }));
    await screen.findByText("Page 2");
    expect(listEventsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "cursor-2" }),
      expect.any(AbortSignal),
    );
    expect(screen.getByRole("button", { name: "Older" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Newer" }));
    await screen.findByText("Page 1");
    expect(listEventsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: undefined }),
      expect.any(AbortSignal),
    );
  });

  it("says when a later page is empty", async () => {
    const user = userEvent.setup();
    listEventsMock
      .mockResolvedValueOnce(page([event()], "cursor-2"))
      .mockResolvedValueOnce(page([], null));

    render(<AdminSecurityWorkspace />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Older" }));

    expect(await screen.findByText("No more events.")).toBeInTheDocument();
  });

  it("shows the access-denied state when the API returns 403", async () => {
    listEventsMock.mockRejectedValueOnce(clientError(403));

    render(<AdminSecurityWorkspace />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have access to this page.",
    );
    expect(screen.queryByLabelText("User")).not.toBeInTheDocument();
  });

  it("shows the API's reason for rejected filters", async () => {
    searchParamsRef.current = new URLSearchParams("ip=999.1.1.1");
    listEventsMock.mockRejectedValueOnce(
      clientError(400, { ip: ["`ip` must be an IPv4 or IPv6 address."] }),
    );

    render(<AdminSecurityWorkspace />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check the filters: ip must be an IPv4 or IPv6 address.",
    );
  });

  it("recovers from a server error with Try again and refreshes on demand", async () => {
    const user = userEvent.setup();
    listEventsMock
      .mockRejectedValueOnce(
        new ApiServerError("Server error", {
          code: "INTERNAL",
          status: 500,
          request: REQUEST,
        }),
      )
      .mockResolvedValueOnce(page([event()]))
      .mockResolvedValueOnce(page([event({ id: "event-2" })]));

    render(<AdminSecurityWorkspace />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load sign-in activity/,
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(listEventsMock).toHaveBeenCalledTimes(3));
  });

  it("opens an account's summary from a row and shows that account's events", async () => {
    const user = userEvent.setup();
    listEventsMock.mockResolvedValue(page([event()]));
    getUserSummaryMock.mockResolvedValueOnce(summary());

    render(<AdminSecurityWorkspace />);
    await screen.findByRole("table");
    await user.click(
      within(table()).getByRole("button", {
        name: "Open security summary for renter-one",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "renter-one" });
    expect(
      await within(dialog).findByText("Password sign-in is locked"),
    ).toBeInTheDocument();
    expect(getUserSummaryMock).toHaveBeenCalledWith(
      "user-1",
      expect.any(AbortSignal),
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Show all events" }),
    );

    expect(routerPushMock).toHaveBeenCalledWith(
      "/admin/security?user=user1%40rentify.local",
      { scroll: false },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
