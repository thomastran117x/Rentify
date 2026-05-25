import { act, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  clearStoredCaptcha,
  useAuthCaptchaToken,
  writeStoredCaptcha,
} from "./captcha-store";

describe("captcha store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearStoredCaptcha();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes and clears captcha tokens through the hook", async () => {
    const { result } = renderHook(() => useAuthCaptchaToken());

    expect(result.current[0]).toBe("");

    act(() => {
      result.current[1]("captcha-token");
    });

    expect(result.current[0]).toBe("captcha-token");
    expect(window.sessionStorage.getItem("rentify.auth.captcha")).toContain(
      "captcha-token",
    );

    act(() => {
      result.current[2]();
    });

    expect(result.current[0]).toBe("");
    expect(window.sessionStorage.getItem("rentify.auth.captcha")).toBeNull();
  });

  it("treats blank tokens as a clear action", async () => {
    const { result } = renderHook(() => useAuthCaptchaToken());

    act(() => {
      writeStoredCaptcha("captcha-token");
    });

    expect(result.current[0]).toBe("captcha-token");

    act(() => {
      result.current[1]("   ");
    });

    expect(result.current[0]).toBe("");
  });

  it("ignores malformed stored captcha payloads", () => {
    window.sessionStorage.setItem("rentify.auth.captcha", "{bad json");

    const { result } = renderHook(() => useAuthCaptchaToken());

    expect(result.current[0]).toBe("");
    expect(window.sessionStorage.getItem("rentify.auth.captcha")).toBeNull();
  });
});
