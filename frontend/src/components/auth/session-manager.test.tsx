import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredAuthSession } from "@/lib/auth/types";
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
    vi.useRealTimers();
    vi.clearAllMocks();
    setVisibility("visible");
    setOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("refreshes a standard token 60 seconds before expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1_000);
    refreshMock.mockResolvedValue(sessionWithToken("replacement"));

    render(
      <SessionManager
        session={sessionWithToken(createToken(NOW_SECONDS, NOW_SECONDS + 900))}
        onComplete={vi.fn()}
      />,
    );
    await flushEffects();

    await advanceTime(839_999);
    expect(refreshMock).not.toHaveBeenCalled();

    await advanceTime(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("reschedules when the stored access token changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1_000);
    refreshMock.mockResolvedValue(sessionWithToken("replacement"));
    const onComplete = vi.fn();
    const { rerender } = render(
      <SessionManager
        session={sessionWithToken(createToken(NOW_SECONDS, NOW_SECONDS + 900))}
        onComplete={onComplete}
      />,
    );
    await flushEffects();

    rerender(
      <SessionManager
        session={sessionWithToken(
          createToken(NOW_SECONDS, NOW_SECONDS + 1_200, "rotated"),
        )}
        onComplete={onComplete}
      />,
    );
    await flushEffects();

    await advanceTime(840_000);
    expect(refreshMock).not.toHaveBeenCalled();

    await advanceTime(300_000);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("does not schedule malformed access tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1_000);

    render(
      <SessionManager
        session={sessionWithToken("not-a-jwt")}
        onComplete={vi.fn()}
      />,
    );
    await flushEffects();
    await advanceTime(24 * 60 * 60 * 1_000);

    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("pauses while hidden and catches up when visible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1_000);
    setVisibility("hidden");
    refreshMock.mockResolvedValue(sessionWithToken("replacement"));

    render(
      <SessionManager
        session={sessionWithToken(createToken(NOW_SECONDS, NOW_SECONDS + 900))}
        onComplete={vi.fn()}
      />,
    );
    await flushEffects();
    vi.setSystemTime((NOW_SECONDS + 900) * 1_000);
    await flushEffects();

    expect(refreshMock).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("catches up on focus after a suspended timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1_000);
    refreshMock.mockResolvedValue(sessionWithToken("replacement"));

    render(
      <SessionManager
        session={sessionWithToken(createToken(NOW_SECONDS, NOW_SECONDS + 900))}
        onComplete={vi.fn()}
      />,
    );
    await flushEffects();
    vi.setSystemTime((NOW_SECONDS + 850) * 1_000);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("waits for connectivity and refreshes when the browser comes online", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1_000);
    setOnline(false);
    refreshMock.mockResolvedValue(sessionWithToken("replacement"));

    render(
      <SessionManager
        session={sessionWithToken(createToken(NOW_SECONDS, NOW_SECONDS + 900))}
        onComplete={vi.fn()}
      />,
    );
    await flushEffects();
    vi.setSystemTime((NOW_SECONDS + 900) * 1_000);

    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures with capped exponential backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1_000);
    refreshMock.mockRejectedValue(new Error("temporarily unavailable"));

    render(
      <SessionManager
        session={sessionWithToken(
          createToken(NOW_SECONDS - 100, NOW_SECONDS + 10),
        )}
        onComplete={vi.fn()}
      />,
    );
    await flushEffects();
    expect(refreshMock).toHaveBeenCalledTimes(1);

    const retryDelays = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000];

    for (const [index, delay] of retryDelays.entries()) {
      await advanceTime(delay - 1);
      expect(refreshMock).toHaveBeenCalledTimes(index + 1);
      await advanceTime(1);
      expect(refreshMock).toHaveBeenCalledTimes(index + 2);
    }
  });

  it("cancels the pending refresh when the session is cleared", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1_000);
    const onComplete = vi.fn();
    const { rerender } = render(
      <SessionManager
        session={sessionWithToken(createToken(NOW_SECONDS, NOW_SECONDS + 900))}
        onComplete={onComplete}
      />,
    );
    await flushEffects();

    rerender(<SessionManager session={null} onComplete={onComplete} />);
    await flushEffects();
    await advanceTime(900_000);

    expect(refreshMock).not.toHaveBeenCalled();
  });
});

const NOW_SECONDS = 1_800_000_000;

function encodeBase64Url(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function createToken(iat: number, exp: number, marker = "initial"): string {
  return `${encodeBase64Url({ alg: "HS256", typ: "JWT" })}.${encodeBase64Url({ iat, exp, marker })}.signature`;
}

function sessionWithToken(accessToken: string): StoredAuthSession {
  return {
    accessToken,
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
  };
}

function setVisibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advanceTime(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}
