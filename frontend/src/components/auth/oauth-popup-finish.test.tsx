import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthPopupFinish } from "./oauth-popup-finish";

describe("OAuthPopupFinish", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("notifies the opener with a hash payload and closes the popup", () => {
    const postMessage = vi.fn();
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: { postMessage },
    });
    window.history.replaceState({}, "", "/auth/google#code=abc");

    render(<OAuthPopupFinish />);

    expect(screen.getByText("Finishing sign-in...")).toBeInTheDocument();
    expect(postMessage).toHaveBeenCalledWith(
      { source: "rentify-oauth-popup", payload: "#code=abc" },
      window.location.origin,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("renders without messaging when it was not opened as a popup", () => {
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: null,
    });
    expect(() => render(<OAuthPopupFinish />)).not.toThrow();
  });
});
