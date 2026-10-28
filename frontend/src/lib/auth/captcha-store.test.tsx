import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoredCaptcha,
  useAuthCaptchaToken,
  writeStoredCaptcha,
} from "./captcha-store";

describe("captcha store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearStoredCaptcha("login");
    clearStoredCaptcha("unlock");
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes and clears captcha tokens through the hook", async () => {
    const { result } = renderHook(() => useAuthCaptchaToken("login"));

    expect(result.current[0]).toBe("");

    act(() => {
      result.current[1]("captcha-token");
    });

    expect(result.current[0]).toBe("captcha-token");
    expect(
      window.sessionStorage.getItem("rentify.auth.captcha.login"),
    ).toContain("captcha-token");

    act(() => {
      result.current[2]();
    });

    expect(result.current[0]).toBe("");
    expect(
      window.sessionStorage.getItem("rentify.auth.captcha.login"),
    ).toBeNull();
  });

  it("keeps each action's token separate", () => {
    const login = renderHook(() => useAuthCaptchaToken("login"));
    const unlock = renderHook(() => useAuthCaptchaToken("unlock"));

    act(() => {
      writeStoredCaptcha("login", "login-token");
    });

    expect(login.result.current[0]).toBe("login-token");
    expect(unlock.result.current[0]).toBe("");

    act(() => {
      writeStoredCaptcha("unlock", "unlock-token");
      clearStoredCaptcha("login");
    });

    expect(login.result.current[0]).toBe("");
    expect(unlock.result.current[0]).toBe("unlock-token");
  });

  it("treats blank tokens as a clear action", async () => {
    const { result } = renderHook(() => useAuthCaptchaToken("login"));

    act(() => {
      writeStoredCaptcha("login", "captcha-token");
    });

    expect(result.current[0]).toBe("captcha-token");

    act(() => {
      result.current[1]("   ");
    });

    expect(result.current[0]).toBe("");
  });

  it("drops a token once it is older than four minutes", () => {
    act(() => {
      writeStoredCaptcha("login", "captcha-token");
    });

    vi.advanceTimersByTime(4 * 60 * 1000 + 1);

    const { result } = renderHook(() => useAuthCaptchaToken("login"));

    expect(result.current[0]).toBe("");
  });

  it("ignores malformed stored captcha payloads", () => {
    window.sessionStorage.setItem("rentify.auth.captcha.login", "{bad json");

    const { result } = renderHook(() => useAuthCaptchaToken("login"));

    expect(result.current[0]).toBe("");
    expect(
      window.sessionStorage.getItem("rentify.auth.captcha.login"),
    ).toBeNull();
  });
});
