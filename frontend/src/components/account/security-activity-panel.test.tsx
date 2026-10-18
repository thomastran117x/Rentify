import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiServerError } from "@/lib/api/types";
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
