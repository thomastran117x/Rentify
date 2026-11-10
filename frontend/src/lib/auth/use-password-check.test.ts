import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPasswordCheckError, usePasswordCheck } from "./use-password-check";

const { checkPasswordMock } = vi.hoisted(() => ({
  checkPasswordMock: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: { checkPassword: checkPasswordMock },
}));

const COMMON = {
  code: "common" as const,
  message: "This password is too common or easy to guess.",
};

describe("usePasswordCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPasswordMock.mockResolvedValue({
      acceptable: true,
      issues: [],
      warnings: [],
    });
  });

  it("sends nothing until the local rules pass", async () => {
    const { result } = renderHook(() =>
      usePasswordCheck("short", { username: "taylor" }),
    );

    expect(result.current.status).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkPasswordMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a password containing the user's details", async () => {
    const { result } = renderHook(() =>
      usePasswordCheck("all-about-taylor", { username: "taylor" }),
    );

    expect(result.current.status).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkPasswordMock).not.toHaveBeenCalled();
  });

  it("does not check while disabled", async () => {
    const { result } = renderHook(() =>
      usePasswordCheck("tidal-harbor-lantern", {}, { enabled: false }),
    );

    expect(result.current.status).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkPasswordMock).not.toHaveBeenCalled();
  });

  it("posts the password and trimmed context after the debounce", async () => {
    checkPasswordMock.mockResolvedValue({
      acceptable: false,
      issues: [COMMON],
      warnings: [],
    });

    const { result } = renderHook(() =>
      usePasswordCheck("qwertyuiop12345", {
        username: " taylor ",
        email: "",
        firstName: "Taylor",
      }),
    );

    expect(result.current.status).toBe("checking");
    await waitFor(() => expect(result.current.status).toBe("checked"));
    expect(result.current.issues).toEqual([COMMON]);
    expect(getPasswordCheckError(result.current)).toBe(COMMON.message);
    expect(checkPasswordMock).toHaveBeenCalledTimes(1);
    expect(checkPasswordMock).toHaveBeenCalledWith(
      {
        password: "qwertyuiop12345",
        username: "taylor",
        email: undefined,
        firstName: "Taylor",
        lastName: undefined,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("only sends the last value typed within the debounce", async () => {
    const { result, rerender } = renderHook(
      ({ password }) => usePasswordCheck(password),
      { initialProps: { password: "tidal-harbor-l" } },
    );

    rerender({ password: "tidal-harbor-la" });
    rerender({ password: "tidal-harbor-lantern" });

    await waitFor(() => expect(result.current.status).toBe("checked"));
    expect(checkPasswordMock).toHaveBeenCalledTimes(1);
    expect(checkPasswordMock).toHaveBeenCalledWith(
      expect.objectContaining({ password: "tidal-harbor-lantern" }),
      expect.anything(),
    );
  });

  it("never shows a verdict for a value it was not fetched for", async () => {
    checkPasswordMock.mockResolvedValueOnce({
      acceptable: false,
      issues: [COMMON],
      warnings: [],
    });
    const { result, rerender } = renderHook(
      ({ password }) => usePasswordCheck(password),
      { initialProps: { password: "qwertyuiop12345" } },
    );

    await waitFor(() => expect(result.current.issues).toEqual([COMMON]));

    rerender({ password: "tidal-harbor-lantern" });
    expect(result.current.status).toBe("checking");
    expect(result.current.issues).toEqual([]);
  });

  it("reports a failed check without blocking anything", async () => {
    checkPasswordMock.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() =>
      usePasswordCheck("tidal-harbor-lantern"),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(getPasswordCheckError(result.current)).toBeNull();
  });

  it("ignores an aborted request", async () => {
    checkPasswordMock.mockRejectedValue(
      new DOMException("aborted", "AbortError"),
    );

    const { result } = renderHook(() =>
      usePasswordCheck("tidal-harbor-lantern"),
    );

    await waitFor(() => expect(checkPasswordMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.status).toBe("checking");
  });

  it("keeps warnings apart from issues", async () => {
    const warning = { code: "breached" as const, message: "Seen in a breach." };
    checkPasswordMock.mockResolvedValue({
      acceptable: true,
      issues: [],
      warnings: [warning],
    });

    const { result } = renderHook(() =>
      usePasswordCheck("tidal-harbor-lantern"),
    );

    await waitFor(() => expect(result.current.status).toBe("checked"));
    expect(result.current.warnings).toEqual([warning]);
    expect(getPasswordCheckError(result.current)).toBeNull();
  });
});
