import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "./session-manager";

const { hasRefreshCookieHintMock, refreshMock } = vi.hoisted(() => ({
  hasRefreshCookieHintMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    hasRefreshCookieHint: hasRefreshCookieHintMock,
    refresh: refreshMock,
  },
}));

describe("SessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes once when restoring an anonymous session with a refresh hint", async () => {
    hasRefreshCookieHintMock.mockReturnValue(true);
    refreshMock.mockResolvedValue(null);
    const onComplete = vi.fn();

    const { rerender } = render(
      <SessionManager session={null} onComplete={onComplete} />,
    );

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    rerender(<SessionManager session={null} onComplete={onComplete} />);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it("skips refresh when a session already exists", async () => {
    hasRefreshCookieHintMock.mockReturnValue(true);
    const onComplete = vi.fn();

    render(
      <SessionManager
        session={{
          accessToken: "access-token",
          device: {
            known: true,
            knownByIp: false,
          },
          user: {
            id: "user-1",
            email: "person@example.com",
            username: "person",
            role: "user",
          },
        }}
        onComplete={onComplete}
      />,
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("always completes even when refresh fails", async () => {
    hasRefreshCookieHintMock.mockReturnValue(true);
    refreshMock.mockRejectedValue(new Error("refresh failed"));
    const onComplete = vi.fn();

    render(<SessionManager session={null} onComplete={onComplete} />);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });
});
