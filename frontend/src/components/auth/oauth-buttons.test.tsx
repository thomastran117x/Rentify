import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthOAuthButtons } from "./oauth-buttons";

const { authenticateGoogleMock } = vi.hoisted(() => ({ authenticateGoogleMock: vi.fn() }));

vi.mock("@/lib/env", () => ({
  publicEnv: { googleOAuthClientId: "google-client", microsoftOAuthClientId: "microsoft-client", microsoftOAuthTenant: "tenant" },
}));
vi.mock("@/lib/auth/api", () => ({
  authApi: { authenticateWithGoogle: authenticateGoogleMock, authenticateWithMicrosoft: vi.fn(), linkOAuthProvider: vi.fn() },
}));

describe("AuthOAuthButtons", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports a blocked popup", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<AuthOAuthButtons onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(onError).toHaveBeenLastCalledWith("Your browser blocked the sign-in popup. Please allow popups and try again."));
  });

  it("exchanges a verified Google popup code for an authenticated session", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const popup = { closed: false, close: vi.fn() };
    const openMock = vi.spyOn(window, "open").mockReturnValue(popup as never);
    authenticateGoogleMock.mockResolvedValue({ accessToken: "access" });
    render(<AuthOAuthButtons onError={onError} onSuccess={onSuccess} />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(openMock).toHaveBeenCalled());
    const url = new URL(String(openMock.mock.calls[0]![0]));
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { source: "rentify-oauth-popup", payload: `#code=code-1&state=${url.searchParams.get("state")}` },
    }));

    await waitFor(() => expect(authenticateGoogleMock).toHaveBeenCalledWith(expect.objectContaining({ code: "code-1" })));
    expect(onSuccess).toHaveBeenCalledWith({ accessToken: "access" });
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("hides providers disabled by configuration", () => {
    render(<AuthOAuthButtons onError={vi.fn()} disabledProviders={["google", "microsoft"]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
