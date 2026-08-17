import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUsernameAvailability } from "./use-username-availability";

const { checkUsernameAvailabilityMock } = vi.hoisted(() => ({
  checkUsernameAvailabilityMock: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    checkUsernameAvailability: checkUsernameAvailabilityMock,
  },
}));

function available(username: string) {
  return { username, available: true, reason: null };
}

function taken(username: string) {
  return { username, available: false, reason: "taken" as const };
}

describe("useUsernameAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkUsernameAvailabilityMock.mockResolvedValue(available("jane-doe"));
  });

  it("stays idle and sends nothing for a username that fails the format rule", async () => {
    const { result } = renderHook(() => useUsernameAvailability("no"));

    expect(result.current.status).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkUsernameAvailabilityMock).not.toHaveBeenCalled();
  });

  it("reports an available username after the debounce", async () => {
    const { result } = renderHook(() => useUsernameAvailability("jane-doe"));

    expect(result.current.status).toBe("checking");

    await waitFor(() => expect(result.current.status).toBe("available"));
    expect(result.current.message).toContain("jane-doe");
    expect(checkUsernameAvailabilityMock).toHaveBeenCalledWith(
      "jane-doe",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("reports a taken username", async () => {
    checkUsernameAvailabilityMock.mockResolvedValue(taken("jane-doe"));

    const { result } = renderHook(() => useUsernameAvailability("jane-doe"));

    await waitFor(() => expect(result.current.status).toBe("taken"));
    expect(result.current.message).toBe("That username is already taken.");
  });

  it("normalizes the value before checking it", async () => {
    const { result } = renderHook(() =>
      useUsernameAvailability("  Jane-Doe  "),
    );

    await waitFor(() => expect(result.current.status).toBe("available"));
    expect(checkUsernameAvailabilityMock).toHaveBeenCalledWith(
      "jane-doe",
      expect.anything(),
    );
  });

  it("stays idle when the value matches the account's current username", async () => {
    const { result } = renderHook(() =>
      useUsernameAvailability("Jane-Doe", { currentUsername: "jane-doe" }),
    );

    expect(result.current.status).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkUsernameAvailabilityMock).not.toHaveBeenCalled();
  });

  it("sends nothing while disabled", async () => {
    const { result } = renderHook(() =>
      useUsernameAvailability("jane-doe", { enabled: false }),
    );

    expect(result.current.status).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkUsernameAvailabilityMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed check without claiming the name is taken", async () => {
    checkUsernameAvailabilityMock.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useUsernameAvailability("jane-doe"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.message).toBe(
      "We couldn't check that username right now.",
    );
  });

  it("debounces typing into a single request for the final value", async () => {
    const { result, rerender } = renderHook(
      ({ username }) => useUsernameAvailability(username),
      { initialProps: { username: "jan" } },
    );

    rerender({ username: "jane" });
    rerender({ username: "jane-doe" });

    await waitFor(() => expect(result.current.status).toBe("available"));

    expect(checkUsernameAvailabilityMock).toHaveBeenCalledTimes(1);
    expect(checkUsernameAvailabilityMock).toHaveBeenCalledWith(
      "jane-doe",
      expect.anything(),
    );
  });

  it("ignores a superseded response so a slow check cannot overwrite a newer one", async () => {
    // The request for "jane" resolves only after the value has moved on. Its
    // signal is aborted by then, so its verdict must be dropped.
    let resolveFirst: ((value: unknown) => void) | undefined;
    checkUsernameAvailabilityMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ username }) => useUsernameAvailability(username),
      { initialProps: { username: "jane" } },
    );

    await waitFor(() =>
      expect(checkUsernameAvailabilityMock).toHaveBeenCalledTimes(1),
    );

    checkUsernameAvailabilityMock.mockResolvedValue(taken("jane-doe"));
    rerender({ username: "jane-doe" });

    await act(async () => {
      resolveFirst?.(available("jane"));
    });

    await waitFor(() => expect(result.current.status).toBe("taken"));
  });
});
