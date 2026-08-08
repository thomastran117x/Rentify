import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTheme, setTheme, toggleTheme, useTheme } from "./use-theme";

describe("theme store", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    vi.restoreAllMocks();
  });

  it("reads, sets, persists, and toggles the document theme", () => {
    expect(getTheme()).toBe("light");

    setTheme("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("rentify-theme")).toBe("dark");

    toggleTheme();
    expect(getTheme()).toBe("light");
    expect(window.localStorage.getItem("rentify-theme")).toBe("light");
  });

  it("continues when local storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => setTheme("dark")).not.toThrow();
    expect(getTheme()).toBe("dark");
  });

  it("keeps hook consumers synchronized after a theme change", () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("light");
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("dark");
  });
});
