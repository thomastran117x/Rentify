import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiServerError } from "@/lib/api/types";
import {
  ACTIVITY_CACHE_FRESH_MS,
  clearActivityCache,
} from "@/lib/security-activity/cache";
import { toActivityDateRange } from "@/lib/security-activity/format";
import type {
  SecurityActivityItem,
  SecurityActivityList,
} from "@/lib/security-activity/types";

const { listMineMock } = vi.hoisted(() => ({ listMineMock: vi.fn() }));

vi.mock("@/lib/security-activity/api", () => ({
  securityActivityApi: { listMine: listMineMock },
}));

const { SecurityActivityPanel } = await import(
  "@/components/account/security-activity-panel"
);

function item(
  overrides: Partial<SecurityActivityItem> = {},
): SecurityActivityItem {
  return {
    id: "event-1",
    type: "login.succeeded",
    outcome: "success",
    label: "Signed in with password",
    occurredAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    method: "password",
    ipAddress: "203.0.113.24",
    browser: "Chrome",
    os: "Windows",
    deviceKnown: true,
    current: true,
    ...overrides,
  };
}

function page(
  items: SecurityActivityItem[],
  nextCursor: string | null = null,
): SecurityActivityList {
  return { items, nextCursor };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function rows() {
  return within(
    screen.getByRole("list", { name: "Security activity" }),
  ).getAllByRole("listitem");
}

describe("SecurityActivityPanel", () => {
  beforeEach(() => {
    listMineMock.mockReset();
    clearActivityCache();
    vi.restoreAllMocks();
  });

  it("shows a loading state, then the rows with their details", async () => {
    const response = deferred<SecurityActivityList>();
    listMineMock.mockReturnValueOnce(response.promise);
    render(<SecurityActivityPanel />);

    expect(
      screen.getByRole("status", { name: "Loading security activity" }),
    ).toBeInTheDocument();
    expect(listMineMock).toHaveBeenCalledWith(
      { limit: 20, category: undefined },
      expect.any(AbortSignal),
    );

    response.resolve(page([item()]));

    expect(
      await screen.findByText("Signed in with password"),
    ).toBeInTheDocument();
    expect(screen.getByText("This session")).toBeInTheDocument();
    expect(rows()[0]).toHaveTextContent(
      "5 minutes ago · Chrome on Windows · 203.0.113.24",
    );
    expect(
      screen.queryByRole("button", { name: "This wasn't me" }),
    ).not.toBeInTheDocument();
  });

  it("marks failed and blocked events distinctly and flags unknown devices", async () => {
    listMineMock.mockResolvedValueOnce(
      page([
        item({
          id: "failed",
          outcome: "failure",
          label: "Failed sign-in: wrong password",
          current: false,
          deviceKnown: false,
        }),
        item({
          id: "blocked",
          outcome: "blocked",
          label: "Sign-in blocked: account locked",
          current: false,
          browser: null,
          os: null,
        }),
      ]),
    );
    render(<SecurityActivityPanel />);

    await screen.findByText("Failed sign-in: wrong password");
    const [failed, blocked] = rows();

    expect(failed).toHaveAttribute("data-outcome", "failure");
    expect(within(failed!).getByText("Failed")).toBeInTheDocument();
    expect(within(failed!).getByText("New device")).toBeInTheDocument();
    expect(blocked).toHaveAttribute("data-outcome", "blocked");
    expect(within(blocked!).getByText("Blocked")).toBeInTheDocument();
    expect(within(blocked!).getByText(/Unknown device/)).toBeInTheDocument();
    expect(within(blocked!).queryByText("New device")).not.toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    listMineMock.mockResolvedValueOnce(page([]));
    render(<SecurityActivityPanel />);

    expect(await screen.findByText("No recent activity")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("shows an error with a retry that reloads the list", async () => {
    const user = userEvent.setup();
    listMineMock
      .mockRejectedValueOnce(
        new ApiServerError("Internal server error.", {
          code: "INTERNAL_SERVER_ERROR",
          status: 500,
          request: {
            method: "GET",
            path: "/auth/audit/me",
            requestUrl: "http://localhost:8040/api/v1",
          },
        }),
      )
      .mockResolvedValueOnce(page([item()]));
    render(<SecurityActivityPanel />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByText("Signed in with password"),
    ).toBeInTheDocument();
    expect(listMineMock).toHaveBeenCalledTimes(2);
  });

  it("re-queries from the first page when the filter changes", async () => {
    const user = userEvent.setup();
    listMineMock
      .mockResolvedValueOnce(page([item()], "cursor-1"))
      .mockResolvedValueOnce(
        page([
          item({
            id: "pw",
            type: "password.changed",
            label: "Password changed",
            current: false,
          }),
        ]),
      );
    render(<SecurityActivityPanel />);
    await screen.findByText("Signed in with password");

    const filter = screen.getByRole("button", { name: "Security changes" });
    expect(filter).toHaveAttribute("aria-pressed", "false");
    await user.click(filter);

    expect(await screen.findByText("Password changed")).toBeInTheDocument();
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(listMineMock).toHaveBeenLastCalledWith(
      { limit: 20, category: "security_changes" },
      expect.any(AbortSignal),
    );
    expect(
      screen.queryByText("Signed in with password"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("appends the next page with the cursor and hides Load more on the last page", async () => {
    const user = userEvent.setup();
    const nextPage = deferred<SecurityActivityList>();
    listMineMock
      .mockResolvedValueOnce(page([item()], "cursor-1"))
      .mockReturnValueOnce(nextPage.promise);
    render(<SecurityActivityPanel />);
    await screen.findByText("Signed in with password");

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(screen.getByRole("button", { name: "Loading..." })).toBeDisabled();
    expect(listMineMock).toHaveBeenLastCalledWith({
      cursor: "cursor-1",
      limit: 20,
      category: undefined,
    });

    nextPage.resolve(
      page([
        item({ id: "event-1" }),
        item({ id: "event-2", label: "Signed out", current: false }),
      ]),
    );

    await screen.findByText("Signed out");
    expect(rows()).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the list and reports a failed Load more", async () => {
    const user = userEvent.setup();
    listMineMock
      .mockResolvedValueOnce(page([item()], "cursor-1"))
      .mockRejectedValueOnce(new Error("offline"));
    render(<SecurityActivityPanel />);
    await screen.findByText("Signed in with password");

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  });

  it("drops a Load more response that arrives after the filter changed", async () => {
    const user = userEvent.setup();
    const stale = deferred<SecurityActivityList>();
    listMineMock
      .mockResolvedValueOnce(page([item()], "cursor-1"))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(page([]));
    render(<SecurityActivityPanel />);
    await screen.findByText("Signed in with password");

    await user.click(screen.getByRole("button", { name: "Load more" }));
    await user.click(screen.getByRole("button", { name: "Sessions" }));
    await screen.findByText("No recent activity");

    stale.resolve(page([item({ id: "late", label: "Late arrival" })]));

    await waitFor(() =>
      expect(screen.queryByText("Late arrival")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
  });

  it("filters by a local date range, combined with the category and Load more", async () => {
    const user = userEvent.setup();
    listMineMock
      .mockResolvedValueOnce(page([item()]))
      .mockResolvedValueOnce(page([item()]))
      .mockResolvedValueOnce(page([item({ id: "in-range" })], "cursor-1"))
      .mockResolvedValueOnce(page([item({ id: "older", label: "Older" })]));
    render(<SecurityActivityPanel />);
    await screen.findByText("Signed in with password");
    const range = toActivityDateRange("2026-10-01", "2026-10-07");

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-10-01" },
    });
    await waitFor(() =>
      expect(listMineMock).toHaveBeenLastCalledWith(
        {
          limit: 20,
          category: undefined,
          outcome: undefined,
          from: range.from,
          to: undefined,
        },
        expect.any(AbortSignal),
      ),
    );
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-10-07" },
    });
    await waitFor(() =>
      expect(listMineMock).toHaveBeenLastCalledWith(
        { limit: 20, category: undefined, ...range },
        expect.any(AbortSignal),
      ),
    );

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    expect(listMineMock).toHaveBeenLastCalledWith({
      cursor: "cursor-1",
      limit: 20,
      category: undefined,
      ...range,
    });
    expect(await screen.findByText("Older")).toBeInTheDocument();
  });

  it("filters by status alongside the category and Load more", async () => {
    const user = userEvent.setup();
    listMineMock
      .mockResolvedValueOnce(page([item()]))
      .mockResolvedValueOnce(
        page(
          [
            item({
              id: "failed",
              outcome: "failure",
              label: "Failed sign-in: wrong password",
              current: false,
            }),
          ],
          "cursor-1",
        ),
      )
      .mockResolvedValueOnce(page([]));
    render(<SecurityActivityPanel />);
    await screen.findByText("Signed in with password");

    await user.selectOptions(screen.getByLabelText("Status"), "Failed");

    expect(
      await screen.findByText("Failed sign-in: wrong password"),
    ).toBeInTheDocument();
    expect(listMineMock).toHaveBeenLastCalledWith(
      { limit: 20, category: undefined, outcome: "failure" },
      expect.any(AbortSignal),
    );
    expect(
      screen.queryByText("Signed in with password"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(listMineMock).toHaveBeenLastCalledWith({
      limit: 20,
      category: undefined,
      outcome: "failure",
      cursor: "cursor-1",
    });
  });

  it("explains an inverted range without querying, then recovers", async () => {
    listMineMock.mockResolvedValue(page([]));
    render(<SecurityActivityPanel />);
    await screen.findByText("No recent activity");

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-10-01" },
    });
    await screen.findByText("No activity matches these filters");
    const callsBefore = listMineMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-10-05" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The To date must be on or after the From date.",
    );
    expect(screen.getByLabelText("From")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(listMineMock).toHaveBeenCalledTimes(callsBefore);

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-09-25" },
    });
    expect(
      await screen.findByText("No activity matches these filters"),
    ).toBeInTheDocument();
    expect(listMineMock).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it("clears the date range and reloads the unfiltered list", async () => {
    const user = userEvent.setup();
    listMineMock.mockResolvedValue(page([item()]));
    render(<SecurityActivityPanel />);
    await screen.findByText("Signed in with password");
    expect(
      screen.queryByRole("button", { name: "Clear dates" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-10-01" },
    });
    await user.click(
      await screen.findByRole("button", { name: "Clear dates" }),
    );

    expect(screen.getByLabelText("From")).toHaveValue("");
    await waitFor(() =>
      expect(listMineMock).toHaveBeenLastCalledWith(
        { limit: 20, category: undefined, from: undefined, to: undefined },
        expect.any(AbortSignal),
      ),
    );
  });

  describe("caching", () => {
    function at(ms: number) {
      vi.spyOn(Date, "now").mockReturnValue(ms);
    }

    it("shows a fresh cached list on return without a request or skeleton", async () => {
      at(1_000_000);
      listMineMock.mockResolvedValueOnce(page([item()], "cursor-1"));
      const first = render(<SecurityActivityPanel userId="user-1" />);
      await screen.findByText("Signed in with password");
      first.unmount();

      at(1_000_000 + ACTIVITY_CACHE_FRESH_MS - 1);
      render(<SecurityActivityPanel userId="user-1" />);

      expect(screen.getByText("Signed in with password")).toBeInTheDocument();
      expect(
        screen.queryByRole("status", { name: "Loading security activity" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
      expect(listMineMock).toHaveBeenCalledTimes(1);
    });

    it("shows a stale cached list at once, then replaces it with fresh data", async () => {
      at(1_000_000);
      listMineMock
        .mockResolvedValueOnce(page([item({ label: "Cached row" })]))
        .mockResolvedValueOnce(page([item({ label: "Fresh row" })]));
      const first = render(<SecurityActivityPanel userId="user-1" />);
      await screen.findByText("Cached row");
      first.unmount();

      at(1_000_000 + ACTIVITY_CACHE_FRESH_MS + 1);
      render(<SecurityActivityPanel userId="user-1" />);

      expect(screen.getByText("Cached row")).toBeInTheDocument();
      expect(await screen.findByText("Fresh row")).toBeInTheDocument();
      expect(listMineMock).toHaveBeenCalledTimes(2);
    });

    it("keeps the stale list when the background refresh fails", async () => {
      at(1_000_000);
      listMineMock
        .mockResolvedValueOnce(page([item({ label: "Cached row" })]))
        .mockRejectedValueOnce(new Error("offline"));
      const first = render(<SecurityActivityPanel userId="user-1" />);
      await screen.findByText("Cached row");
      first.unmount();

      at(1_000_000 + ACTIVITY_CACHE_FRESH_MS + 1);
      render(<SecurityActivityPanel userId="user-1" />);
      await waitFor(() => expect(listMineMock).toHaveBeenCalledTimes(2));

      expect(screen.getByText("Cached row")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("serves a filter visited moments ago straight from the cache", async () => {
      const user = userEvent.setup();
      at(1_000_000);
      listMineMock
        .mockResolvedValueOnce(page([item({ label: "All rows" })]))
        .mockResolvedValueOnce(page([item({ label: "Session rows" })]));
      render(<SecurityActivityPanel userId="user-1" />);
      await screen.findByText("All rows");

      await user.click(screen.getByRole("button", { name: "Sessions" }));
      await screen.findByText("Session rows");
      await user.click(screen.getByRole("button", { name: "All" }));

      expect(screen.getByText("All rows")).toBeInTheDocument();
      expect(listMineMock).toHaveBeenCalledTimes(2);
    });

    it("refetches on Refresh even while the cache is fresh", async () => {
      const user = userEvent.setup();
      at(1_000_000);
      listMineMock
        .mockResolvedValueOnce(page([item({ label: "Cached row" })]))
        .mockResolvedValueOnce(page([item({ label: "Refreshed row" })]));
      render(<SecurityActivityPanel userId="user-1" />);
      await screen.findByText("Cached row");

      await user.click(
        screen.getByRole("button", { name: "Refresh security activity" }),
      );

      expect(await screen.findByText("Refreshed row")).toBeInTheDocument();
      expect(listMineMock).toHaveBeenCalledTimes(2);
    });

    it("never shows one user's cached history to another", async () => {
      at(1_000_000);
      listMineMock
        .mockResolvedValueOnce(page([item({ label: "User one row" })]))
        .mockResolvedValueOnce(page([]));
      const first = render(<SecurityActivityPanel userId="user-1" />);
      await screen.findByText("User one row");
      first.unmount();

      render(<SecurityActivityPanel userId="user-2" />);

      expect(screen.queryByText("User one row")).not.toBeInTheDocument();
      expect(await screen.findByText("No recent activity")).toBeInTheDocument();
      expect(listMineMock).toHaveBeenCalledTimes(2);
    });

    it("caches nothing without a user id", async () => {
      listMineMock.mockResolvedValue(page([item()]));
      const first = render(<SecurityActivityPanel />);
      await screen.findByText("Signed in with password");
      first.unmount();

      render(<SecurityActivityPanel />);

      expect(
        screen.getByRole("status", { name: "Loading security activity" }),
      ).toBeInTheDocument();
      await waitFor(() => expect(listMineMock).toHaveBeenCalledTimes(2));
    });
  });

  it("reports an event that was not the user and shows guidance", async () => {
    const user = userEvent.setup();
    const onReportActivity = vi.fn();
    const suspicious = item({
      id: "suspicious",
      outcome: "failure",
      label: "Failed sign-in: wrong password",
      current: false,
    });
    listMineMock.mockResolvedValueOnce(page([suspicious]));
    render(<SecurityActivityPanel onReportActivity={onReportActivity} />);

    await user.click(
      await screen.findByRole("button", { name: "This wasn't me" }),
    );

    expect(onReportActivity).toHaveBeenCalledWith(suspicious);
    expect(screen.getByText(/Change your password now/)).toBeInTheDocument();
  });
});
