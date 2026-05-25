import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/auth/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeSessionPanel } from "./home-session-panel";

const {
  useAuthMock,
  logoutMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  logoutMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    logout: logoutMock,
  },
}));

vi.mock("@/components/home/home-password-panel", () => ({
  HomePasswordPanel: () => <div>Password panel placeholder</div>,
}));

describe("HomeSessionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          email: "person@example.com",
        },
      },
      clearSession: vi.fn(),
    });
  });

  it("shows the authenticated session state", () => {
    render(<HomeSessionPanel />);

    expect(
      screen.getByText("Signed in as person@example.com."),
    ).toBeInTheDocument();
    expect(screen.getByText("Password panel placeholder")).toBeInTheDocument();
  });

  it("logs out successfully and clears local auth state", async () => {
    const user = userEvent.setup();
    const clearSession = vi.fn();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          email: "person@example.com",
        },
      },
      clearSession,
    });
    logoutMock.mockResolvedValue({ loggedOut: true });

    render(<HomeSessionPanel />);

    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalled();
    });
    expect(clearSession).toHaveBeenCalled();
    expect(
      screen.getByText("Logged out. You can retest Microsoft OAuth now."),
    ).toBeInTheDocument();
  });

  it("handles expired sessions by still clearing local state", async () => {
    const user = userEvent.setup();
    const clearSession = vi.fn();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          email: "person@example.com",
        },
      },
      clearSession,
    });
    logoutMock.mockRejectedValue(
      new ApiError("Expired", "UNAUTHORIZED", 401),
    );

    render(<HomeSessionPanel />);

    await user.click(screen.getByRole("button", { name: "Log out" }));

    expect(clearSession).toHaveBeenCalled();
    expect(
      await screen.findByText(
        "The session was already expired, so local auth state was cleared.",
      ),
    ).toBeInTheDocument();
  });
});
