import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthOAuthButtons } from "./oauth-buttons";

const {
  authenticateGoogleMock,
  authenticateMicrosoftMock,
  linkOAuthProviderMock,
} = vi.hoisted(() => ({
  authenticateGoogleMock: vi.fn(),
  authenticateMicrosoftMock: vi.fn(),
  linkOAuthProviderMock: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  publicEnv: { googleOAuthClientId: "google-client", microsoftOAuthClientId: "microsoft-client", microsoftOAuthTenant: "tenant" },
}));
vi.mock("@/lib/auth/api", () => ({
  authApi: {
    authenticateWithGoogle: authenticateGoogleMock,
    authenticateWithMicrosoft: authenticateMicrosoftMock,
    linkOAuthProvider: linkOAuthProviderMock,
  },
}));

describe("AuthOAuthButtons", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function popupResult() {
    return { closed: false, close: vi.fn() };
  }

  async function openAndRespond(
    user: ReturnType<typeof userEvent.setup>,
    buttonName: string,
    payload: (state: string | null) => string,
  ) {
    const popup = popupResult();
    const openMock = vi.spyOn(window, "open").mockReturnValue(popup as never);
    await user.click(screen.getByRole("button", { name: buttonName }));
    await waitFor(() => expect(openMock).toHaveBeenCalled());
    const url = new URL(String(openMock.mock.calls[0]![0]));
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "rentify-oauth-popup",
          payload: payload(url.searchParams.get("state")),
        },
      }),
    );
    return { popup, openMock, url };
  }

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
      origin: "https://attacker.example",
      data: { source: "rentify-oauth-popup", payload: "#code=ignored" },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { source: "another-app", payload: "#code=ignored" },
    }));
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

  it("rejects a popup response whose state cannot be verified", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(<AuthOAuthButtons onError={onError} />);

    const { popup } = await openAndRespond(
      user,
      "Continue with Google",
      () => "?code=code-1&state=wrong-state",
    );

    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith(
        "The sign-in response could not be verified. Please try again.",
      ),
    );
    expect(popup.close).toHaveBeenCalled();
  });

  it("surfaces the provider error description", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(<AuthOAuthButtons onError={onError} />);

    await openAndRespond(
      user,
      "Continue with Google",
      (state) =>
        `#error=access_denied&error_description=User+cancelled&state=${state}`,
    );

    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith("User cancelled"),
    );
  });

  it("falls back to a named provider error when no description exists", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(<AuthOAuthButtons onError={onError} />);

    await openAndRespond(
      user,
      "Continue with Google",
      (state) => `#error=access_denied&state=${state}`,
    );

    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith(
        "Google sign-in failed: access_denied.",
      ),
    );
  });

  it("links a Google provider in link mode", async () => {
    const user = userEvent.setup();
    const onLinked = vi.fn();
    linkOAuthProviderMock.mockResolvedValue({
      hasPassword: true,
      providers: [],
    });
    render(
      <AuthOAuthButtons mode="link" onError={vi.fn()} onLinked={onLinked} />,
    );

    await openAndRespond(
      user,
      "Link Google",
      (state) => `#code=google-code&state=${state}`,
    );

    await waitFor(() =>
      expect(linkOAuthProviderMock).toHaveBeenCalledWith(
        "google",
        expect.objectContaining({ code: "google-code" }),
      ),
    );
    expect(onLinked).toHaveBeenCalledWith({ hasPassword: true, providers: [] });
    expect(screen.getByText("Connect another provider")).toBeInTheDocument();
  });

  it("exchanges a Microsoft code and authenticates with its ID token", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id_token: "microsoft-id-token" }),
    } as never);
    authenticateMicrosoftMock.mockResolvedValue({ accessToken: "ms-access" });
    render(<AuthOAuthButtons onError={vi.fn()} onSuccess={onSuccess} />);

    const { url } = await openAndRespond(
      user,
      "Continue with Microsoft",
      (state) => `?code=ms-code&state=${state}`,
    );

    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.searchParams.get("response_mode")).toBe("query");
    await waitFor(() =>
      expect(authenticateMicrosoftMock).toHaveBeenCalledWith(
        expect.objectContaining({ idToken: "microsoft-id-token" }),
      ),
    );
    expect(onSuccess).toHaveBeenCalledWith({ accessToken: "ms-access" });
  });

  it.each([
    [
      { ok: false, json: vi.fn().mockResolvedValue({ error_description: "Token+exchange+failed" }) },
      "Token exchange failed",
    ],
    [
      { ok: true, json: vi.fn().mockResolvedValue({}) },
      "Microsoft token response did not include an ID token.",
    ],
  ])("reports Microsoft token failure %#", async (response, expected) => {
    const user = userEvent.setup();
    const onError = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response as never);
    render(<AuthOAuthButtons onError={onError} />);

    await openAndRespond(
      user,
      "Continue with Microsoft",
      (state) => `?code=ms-code&state=${state}`,
    );

    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(expected));
  });
});
