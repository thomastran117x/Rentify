import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthOAuthButtons } from "./oauth-buttons";

const {
  authenticateGoogleMock,
  authenticateMicrosoftMock,
  authenticateAppleMock,
  linkOAuthProviderMock,
  publicEnvMock,
} = vi.hoisted(() => ({
  authenticateGoogleMock: vi.fn(),
  authenticateMicrosoftMock: vi.fn(),
  authenticateAppleMock: vi.fn(),
  linkOAuthProviderMock: vi.fn(),
  publicEnvMock: {
    googleOAuthClientId: "google-client",
    microsoftOAuthClientId: "microsoft-client",
    microsoftOAuthTenant: "tenant",
    appleOAuthClientId: "com.rentify.web",
  },
}));

vi.mock("@/lib/env", () => ({ publicEnv: publicEnvMock }));
vi.mock("@/lib/auth/api", () => ({
  authApi: {
    authenticateWithGoogle: authenticateGoogleMock,
    authenticateWithMicrosoft: authenticateMicrosoftMock,
    authenticateWithApple: authenticateAppleMock,
    linkOAuthProvider: linkOAuthProviderMock,
  },
}));

describe("AuthOAuthButtons", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.AppleID;
    publicEnvMock.appleOAuthClientId = "com.rentify.web";
  });

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

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith(
        "Your browser blocked the sign-in popup. Please allow popups and try again.",
      ),
    );
  });

  it("exchanges a verified Google popup code for an authenticated session", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const popup = { closed: false, close: vi.fn() };
    const openMock = vi.spyOn(window, "open").mockReturnValue(popup as never);
    authenticateGoogleMock.mockResolvedValue({ accessToken: "access" });
    render(<AuthOAuthButtons onError={onError} onSuccess={onSuccess} />);

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() => expect(openMock).toHaveBeenCalled());
    const url = new URL(String(openMock.mock.calls[0]![0]));
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://attacker.example",
        data: { source: "rentify-oauth-popup", payload: "#code=ignored" },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { source: "another-app", payload: "#code=ignored" },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "rentify-oauth-popup",
          payload: `#code=code-1&state=${url.searchParams.get("state")}`,
        },
      }),
    );

    await waitFor(() =>
      expect(authenticateGoogleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "code-1",
        }),
      ),
    );
    expect(onSuccess).toHaveBeenCalledWith({ accessToken: "access" });
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("routes a new-account continuation to the signup callback", async () => {
    const user = userEvent.setup();
    const onSignupRequired = vi.fn();
    authenticateGoogleMock.mockResolvedValue({
      signupRequired: true,
      signupToken: "signup-token",
      expiresInSeconds: 600,
    });
    render(
      <AuthOAuthButtons
        onError={vi.fn()}
        onSignupRequired={onSignupRequired}
      />,
    );

    await openAndRespond(
      user,
      "Continue with Google",
      (state) => `?code=code-1&state=${state}`,
    );

    await waitFor(() =>
      expect(onSignupRequired).toHaveBeenCalledWith({
        signupRequired: true,
        signupToken: "signup-token",
        expiresInSeconds: 600,
      }),
    );
  });

  it("hides providers disabled by configuration", () => {
    render(
      <AuthOAuthButtons
        onError={vi.fn()}
        disabledProviders={["google", "microsoft", "apple"]}
      />,
    );
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
      {
        ok: false,
        json: vi
          .fn()
          .mockResolvedValue({ error_description: "Token+exchange+failed" }),
      },
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

  describe("Sign in with Apple", () => {
    function installAppleSdk(signIn: (state: string) => Promise<unknown>): {
      init: ReturnType<typeof vi.fn>;
    } {
      let configuredState = "";
      const init = vi.fn((config: { state: string }) => {
        configuredState = config.state;
      });
      window.AppleID = {
        auth: {
          init,
          signIn: vi.fn(() => signIn(configuredState)),
        },
      } as never;
      return { init };
    }

    it("hides the Apple button when no Services ID is configured", () => {
      publicEnvMock.appleOAuthClientId = "";
      render(<AuthOAuthButtons onError={vi.fn()} />);

      expect(
        screen.queryByRole("button", { name: "Continue with Apple" }),
      ).not.toBeInTheDocument();
    });

    it("authenticates with the Apple ID token and first-consent name", async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      const { init } = installAppleSdk(async (state) => ({
        authorization: { code: "apple-code", id_token: "apple-id", state },
        user: { name: { firstName: " Avery ", lastName: "Apple" } },
      }));
      authenticateAppleMock.mockResolvedValue({ accessToken: "apple-access" });
      render(<AuthOAuthButtons onError={vi.fn()} onSuccess={onSuccess} />);

      await user.click(
        screen.getByRole("button", { name: "Continue with Apple" }),
      );

      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
      const config = init.mock.calls[0]![0];
      expect(config).toMatchObject({
        clientId: "com.rentify.web",
        scope: "name email",
        redirectURI: `${window.location.origin}/auth/apple`,
        usePopup: true,
      });
      expect(authenticateAppleMock).toHaveBeenCalledWith({
        idToken: "apple-id",
        firstName: "Avery",
        lastName: "Apple",
        nonce: config.nonce,
      });
      expect(onSuccess).toHaveBeenCalledWith({ accessToken: "apple-access" });
    });

    it("links Apple in link mode without names on repeat consent", async () => {
      const user = userEvent.setup();
      const onLinked = vi.fn();
      installAppleSdk(async (state) => ({
        authorization: { id_token: "apple-id", state },
      }));
      linkOAuthProviderMock.mockResolvedValue({
        hasPassword: true,
        providers: [],
      });
      render(
        <AuthOAuthButtons mode="link" onError={vi.fn()} onLinked={onLinked} />,
      );

      await user.click(screen.getByRole("button", { name: "Link Apple" }));

      await waitFor(() =>
        expect(linkOAuthProviderMock).toHaveBeenCalledWith(
          "apple",
          expect.objectContaining({
            idToken: "apple-id",
            firstName: undefined,
            lastName: undefined,
          }),
        ),
      );
      expect(onLinked).toHaveBeenCalledWith({
        hasPassword: true,
        providers: [],
      });
    });

    it.each([
      [
        async () => ({
          authorization: { id_token: "apple-id", state: "forged" },
        }),
        "The sign-in response could not be verified. Please try again.",
      ],
      [
        async (state: string) => ({ authorization: { state } }),
        "Apple sign-in could not be completed.",
      ],
      [
        async () => {
          throw { error: "popup_closed_by_user" };
        },
        "The sign-in popup was closed before authentication finished.",
      ],
      [
        async () => {
          throw { error: "invalid_client" };
        },
        "Apple sign-in failed: invalid_client.",
      ],
      [
        async () => {
          throw new Error("boom");
        },
        "Apple sign-in could not be completed.",
      ],
    ])("reports Apple sign-in failure %#", async (signIn, expected) => {
      const user = userEvent.setup();
      const onError = vi.fn();
      installAppleSdk(signIn);
      render(<AuthOAuthButtons onError={onError} />);

      await user.click(
        screen.getByRole("button", { name: "Continue with Apple" }),
      );

      await waitFor(() => expect(onError).toHaveBeenLastCalledWith(expected));
      expect(authenticateAppleMock).not.toHaveBeenCalled();
    });

    // Runs before the retry test below, which leaves a resolved SDK load cached
    // for the rest of the module.
    it("reports an Apple SDK script that loads without exposing AppleID", async () => {
      const user = userEvent.setup();
      const onError = vi.fn();
      render(<AuthOAuthButtons onError={onError} />);

      await user.click(
        screen.getByRole("button", { name: "Continue with Apple" }),
      );
      const script = document.head.querySelector(
        'script[src*="appleid.auth.js"]',
      ) as HTMLScriptElement;
      script.dispatchEvent(new Event("load"));

      await waitFor(() =>
        expect(onError).toHaveBeenLastCalledWith(
          "Apple sign-in could not be loaded. Please try again.",
        ),
      );
    });

    it("reports an Apple SDK that fails to load, then loads it on retry", async () => {
      const user = userEvent.setup();
      const onError = vi.fn();
      const onSuccess = vi.fn();
      authenticateAppleMock.mockResolvedValue({ accessToken: "apple-access" });
      render(<AuthOAuthButtons onError={onError} onSuccess={onSuccess} />);
      const button = screen.getByRole("button", {
        name: "Continue with Apple",
      });

      await user.click(button);
      const failedScript = document.head.querySelector(
        'script[src*="appleid.auth.js"]',
      ) as HTMLScriptElement;
      failedScript.dispatchEvent(new Event("error"));
      await waitFor(() =>
        expect(onError).toHaveBeenLastCalledWith(
          "Apple sign-in could not be loaded. Please try again.",
        ),
      );
      expect(
        document.head.querySelector('script[src*="appleid.auth.js"]'),
      ).toBeNull();

      await user.click(button);
      const script = document.head.querySelector(
        'script[src*="appleid.auth.js"]',
      ) as HTMLScriptElement;
      installAppleSdk(async (state) => ({
        authorization: { id_token: "apple-id", state },
      }));
      script.dispatchEvent(new Event("load"));

      await waitFor(() =>
        expect(onSuccess).toHaveBeenCalledWith({ accessToken: "apple-access" }),
      );
      script.remove();
    });
  });
});
