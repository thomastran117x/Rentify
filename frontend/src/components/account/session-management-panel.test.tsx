import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import type { AuthSessionSummary } from "@/lib/auth/types";
import { SessionManagementPanel } from "./session-management-panel";

const {
  listSessionsMock,
  revokeSessionMock,
  revokeSessionsMock,
  clearSessionMock,
  replaceMock,
  refreshMock,
} = vi.hoisted(() => ({
  listSessionsMock: vi.fn(),
  revokeSessionMock: vi.fn(),
  revokeSessionsMock: vi.fn(),
  clearSessionMock: vi.fn(),
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
}));
vi.mock("@/components/auth/auth-context", () => ({
  useAuth: () => ({ clearSession: clearSessionMock }),
}));
vi.mock("@/lib/auth/api", () => ({
  authApi: {
    listSessions: listSessionsMock,
    revokeSession: revokeSessionMock,
    revokeSessions: revokeSessionsMock,
  },
}));

function session(
  id: string,
  options: Partial<AuthSessionSummary> = {},
): AuthSessionSummary {
  return {
    id,
    deviceLabel: id === "current" ? "Chrome on Windows" : "Safari on iPhone",
    platform: id === "current" ? "desktop" : "mobile",
    browser: id === "current" ? "Chrome" : "Safari",
    os: id === "current" ? "Windows" : "iOS",
    firstIpAddress: "192.0.2.1",
    lastIpAddress: "192.0.2.2",
    createdAt: "2026-10-29T12:00:00.000Z",
    lastUsedAt: "2026-10-30T12:00:00.000Z",
    rememberMe: id === "current",
    current: id === "current",
    ...options,
  };
}

function mfaRequiredError() {
  return new ApiClientError("Recent MFA verification is required.", {
    status: 401,
    code: "MFA_VERIFICATION_REQUIRED",
    request: {
      method: "GET",
      path: "/auth/sessions",
      requestUrl: "http://localhost:8040/api/v1/auth/sessions",
      mode: "authenticated",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listSessionsMock.mockResolvedValue({
    sessions: [session("current"), session("other")],
  });
  revokeSessionMock.mockImplementation(async (id: string) => ({
    revoked: true,
    id,
    current: id === "current",
  }));
  revokeSessionsMock.mockImplementation(async (scope: "others" | "all") => ({
    scope,
    revokedSessionCount: scope === "others" ? 1 : 2,
    revokedPersonalAccessTokenCount: scope === "all" ? 3 : 0,
  }));
});

describe("SessionManagementPanel", () => {
  it("shows loading, session details, and the current-session treatment", async () => {
    let resolveList!: (value: { sessions: AuthSessionSummary[] }) => void;
    listSessionsMock.mockReturnValueOnce(
      new Promise<{ sessions: AuthSessionSummary[] }>((resolve) => {
        resolveList = resolve;
      }),
    );

    render(<SessionManagementPanel />);

    expect(
      screen.getByText("Loading signed-in sessions..."),
    ).toBeInTheDocument();
    resolveList({ sessions: [session("current"), session("other")] });

    expect(await screen.findByText("Current session")).toBeInTheDocument();
    expect(screen.getByText("Chrome · Windows · desktop")).toBeInTheDocument();
    expect(screen.getByText("Remember me: On")).toBeInTheDocument();
    expect(screen.getAllByText("192.0.2.1")).toHaveLength(2);
  });

  it("shows an empty state", async () => {
    listSessionsMock.mockResolvedValueOnce({ sessions: [] });

    render(<SessionManagementPanel />);

    expect(
      await screen.findByText("No signed-in sessions found."),
    ).toBeInTheDocument();
  });

  it("shows an API error and retries the list request", async () => {
    listSessionsMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ sessions: [session("current")] });

    render(<SessionManagementPanel />);

    expect(
      await screen.findByText("Your session list is unavailable."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Current session")).toBeInTheDocument();
    expect(listSessionsMock).toHaveBeenCalledTimes(2);
  });

  it("signs out one other session and leaves the current session in place", async () => {
    render(<SessionManagementPanel />);
    await screen.findByText("Current session");

    const otherRow = screen
      .getByRole("heading", {
        name: "Safari on iPhone",
      })
      .closest("article");
    expect(otherRow).not.toBeNull();
    await userEvent.click(
      within(otherRow as HTMLElement).getByRole("button", { name: "Sign out" }),
    );

    await waitFor(() =>
      expect(revokeSessionMock).toHaveBeenCalledWith("other"),
    );
    expect(screen.queryByText("Safari on iPhone")).not.toBeInTheDocument();
    expect(
      screen.getByText("Safari on iPhone was signed out."),
    ).toBeInTheDocument();
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it("signs out all other sessions and disables the bulk action", async () => {
    render(<SessionManagementPanel />);
    const button = await screen.findByRole("button", {
      name: "Sign out of all other sessions",
    });

    await userEvent.click(button);

    await waitFor(() =>
      expect(revokeSessionsMock).toHaveBeenCalledWith("others"),
    );
    expect(screen.queryByText("Safari on iPhone")).not.toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(
      screen.getByText("1 other session was signed out."),
    ).toBeInTheDocument();
  });

  it("requires confirmation, warns about PATs, and signs out locally for all", async () => {
    render(<SessionManagementPanel />);
    await screen.findByText("Current session");
    await userEvent.click(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Sign out everywhere?" });
    expect(
      within(dialog).getByText(/revokes all personal access tokens/i),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Sign out everywhere" }),
    );

    await waitFor(() => expect(revokeSessionsMock).toHaveBeenCalledWith("all"));
    expect(clearSessionMock).toHaveBeenCalledOnce();
    expect(replaceMock).toHaveBeenCalledWith("/login");
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("signs out locally when the current row is revoked", async () => {
    render(<SessionManagementPanel />);
    await screen.findByText("Current session");

    const currentRow = screen.getByText("Current session").closest("article");
    expect(currentRow).not.toBeNull();
    await userEvent.click(
      within(currentRow as HTMLElement).getByRole("button", {
        name: "Sign out",
      }),
    );

    await waitFor(() =>
      expect(revokeSessionMock).toHaveBeenCalledWith("current"),
    );
    expect(clearSessionMock).toHaveBeenCalledOnce();
    expect(replaceMock).toHaveBeenCalledWith("/login");
  });

  it("relocks the parent when the step-up proof expires", async () => {
    listSessionsMock.mockRejectedValueOnce(mfaRequiredError());
    const onVerificationRequired = vi.fn();

    render(
      <SessionManagementPanel
        onVerificationRequired={onVerificationRequired}
      />,
    );

    await waitFor(() => expect(onVerificationRequired).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
