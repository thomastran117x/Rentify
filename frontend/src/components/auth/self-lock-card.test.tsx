import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, ApiNetworkError } from "@/lib/api/types";
import { SelfLockCard } from "./self-lock-card";

const {
  authState,
  clearSessionMock,
  lockWithTokenMock,
  refreshMock,
  logoutMock,
} = vi.hoisted(() => ({
  authState: {
    status: "anonymous" as "anonymous" | "authenticated",
    session: null as { user: { email: string } } | null,
  },
  clearSessionMock: vi.fn(),
  lockWithTokenMock: vi.fn(),
  refreshMock: vi.fn(),
  logoutMock: vi.fn(),
}));

function signOutLocally() {
  authState.status = "anonymous";
  authState.session = null;
}

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: () => ({ ...authState, clearSession: clearSessionMock }),
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: { refresh: refreshMock, logout: logoutMock },
}));

vi.mock("@/lib/auth/self-lock-api", () => ({
  selfLockApi: { lockWithToken: lockWithTokenMock },
}));

const request = {
  method: "POST",
  path: "/auth/account/self-lock",
  requestUrl: "http://localhost:8040/api/v1/auth/account/self-lock",
};

describe("SelfLockCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signOutLocally();
    clearSessionMock.mockImplementation(signOutLocally);
  });

  it("asks for confirmation and locks nothing on its own", () => {
    render(<SelfLockCard token="token-1" />);

    expect(
      screen.getByRole("heading", { name: "Lock your account?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Lock my account" }),
    ).toBeEnabled();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(lockWithTokenMock).not.toHaveBeenCalled();
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it("locks on confirm, disables the button while it runs, then shows recovery", async () => {
    const user = userEvent.setup();
    let resolveLock: (value: { locked: true }) => void = () => undefined;
    lockWithTokenMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLock = resolve;
      }),
    );
    render(<SelfLockCard token="token-1" />);

    await user.click(screen.getByRole("button", { name: "Lock my account" }));

    expect(lockWithTokenMock).toHaveBeenCalledWith("token-1");
    expect(screen.getByRole("button", { name: "Locking..." })).toBeDisabled();

    resolveLock({ locked: true });

    expect(
      await screen.findByRole("heading", { name: "Your account is locked" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Reset your password" }),
    ).toHaveAttribute("href", "/login?recovery=account");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reset your password with the code we email you.",
    );
    // The browser may hold another account's session, which the lock leaves alone.
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it("signs out a browser that was signed in to the locked account, so the reset is reachable", async () => {
    const user = userEvent.setup();
    authState.status = "authenticated";
    authState.session = { user: { email: "owner1@rentify.local" } };
    lockWithTokenMock.mockResolvedValue({ locked: true });
    // The lock bumped the token version, so the refresh fails and the client
    // drops the stored session.
    refreshMock.mockImplementation(async () => {
      signOutLocally();
      return null;
    });
    render(<SelfLockCard token="token-1" />);

    await user.click(screen.getByRole("button", { name: "Lock my account" }));

    expect(
      await screen.findByRole("link", { name: "Reset your password" }),
    ).toHaveAttribute("href", "/login?recovery=account");
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it("asks a browser signed in to another account to sign out before resetting", async () => {
    const user = userEvent.setup();
    authState.status = "authenticated";
    authState.session = { user: { email: "user2@rentify.local" } };
    lockWithTokenMock.mockResolvedValue({ locked: true });
    refreshMock.mockResolvedValue({ user: { email: "user2@rentify.local" } });
    logoutMock.mockResolvedValue({ loggedOut: true });
    render(<SelfLockCard token="token-1" />);

    await user.click(screen.getByRole("button", { name: "Lock my account" }));

    expect(
      await screen.findByText(/signed in as user2@rentify.local/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Reset your password" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(clearSessionMock).toHaveBeenCalled();
    expect(
      await screen.findByRole("link", { name: "Reset your password" }),
    ).toBeInTheDocument();
  });

  it("still signs out locally when the sign-out request fails", async () => {
    const user = userEvent.setup();
    authState.status = "authenticated";
    authState.session = { user: { email: "user2@rentify.local" } };
    logoutMock.mockRejectedValue(new Error("offline"));
    render(<SelfLockCard token={null} />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("link", { name: "Reset your password" }),
    ).toBeInTheDocument();
  });

  it("shows the expired state for a spent or expired link", async () => {
    const user = userEvent.setup();
    lockWithTokenMock.mockRejectedValue(
      new ApiClientError("This link has expired or was already used.", {
        code: "GONE",
        status: 410,
        request,
      }),
    );
    render(<SelfLockCard token="token-1" />);

    await user.click(screen.getByRole("button", { name: "Lock my account" }));

    expect(
      await screen.findByRole("heading", { name: "This link has expired" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing was changed/)).toBeInTheDocument();
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it("keeps the confirmation and offers a retry when the request fails", async () => {
    const user = userEvent.setup();
    lockWithTokenMock
      .mockRejectedValueOnce(
        new ApiNetworkError("Network down", { code: "NETWORK_ERROR", request }),
      )
      .mockResolvedValueOnce({ locked: true });
    render(<SelfLockCard token="token-1" />);

    await user.click(screen.getByRole("button", { name: "Lock my account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your account is not locked",
    );
    expect(
      screen.getByRole("heading", { name: "Lock your account?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Lock my account" }));

    expect(
      await screen.findByRole("heading", { name: "Your account is locked" }),
    ).toBeInTheDocument();
    expect(lockWithTokenMock).toHaveBeenCalledTimes(2);
  });

  it("shows the expired state without a token", () => {
    render(<SelfLockCard token={null} />);

    expect(
      screen.getByRole("heading", { name: "This link has expired" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the locked state after an in-session lock and clears this browser's session", async () => {
    render(<SelfLockCard token={null} alreadyLocked />);

    expect(
      screen.getByRole("heading", { name: "Your account is locked" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(clearSessionMock).toHaveBeenCalled());
    expect(lockWithTokenMock).not.toHaveBeenCalled();
  });
});
