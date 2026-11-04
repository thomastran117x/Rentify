import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthOAuthButtons } from "./oauth-buttons";
import { ApiClientError } from "@/lib/auth/types";

type FlowStart = {
  state: string;
  nonce: string;
  codeChallenge?: string;
  tokenDelivery: "code" | "id_token";
  expiresInSeconds: number;
};

const {
  authenticateGoogleMock,
  authenticateMicrosoftMock,
  authenticateAppleMock,
  linkOAuthProviderMock,
  startOAuthFlowMock,
  serverFlow,
  publicEnvMock,
} = vi.hoisted(() => {
  let issued = 0;
  /** What the backend issues by default: a code flow only for Google. */
  const serverFlow = (provider: string): FlowStart => {
    issued += 1;
    return {
      state: `server-state-${provider}-${issued}`,
      nonce: `server-nonce-${provider}-${issued}`,
      ...(provider === "google"
        ? { codeChallenge: "server-challenge", tokenDelivery: "code" as const }
        : { tokenDelivery: "id_token" as const }),
      expiresInSeconds: 600,
    };
  };

  return {
    serverFlow,
    startOAuthFlowMock: vi.fn(async (provider: string) => serverFlow(provider)),
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
  };
});

vi.mock("@/lib/env", () => ({ publicEnv: publicEnvMock }));
vi.mock("@/lib/auth/api", () => ({
  authApi: {
    authenticateWithGoogle: authenticateGoogleMock,
    authenticateWithMicrosoft: authenticateMicrosoftMock,
    authenticateWithApple: authenticateAppleMock,
    linkOAuthProvider: linkOAuthProviderMock,
    startOAuthFlow: startOAuthFlowMock,
  },
}));

describe("AuthOAuthButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startOAuthFlowMock.mockImplementation(async (provider: string) =>
      serverFlow(provider),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.AppleID;
    publicEnvMock.appleOAuthClientId = "com.rentify.web";
  });

  function popupResult() {
    return { closed: false, close: vi.fn(), location: { href: "" } };
  }

  /** The authorize URL the popup was sent to once the flow started. */
  async function readPopupUrl(popup: ReturnType<typeof popupResult>) {
    await waitFor(() => expect(popup.location.href).not.toBe(""));
    return new URL(popup.location.href);
  }

  async function openAndRespond(
    user: ReturnType<typeof userEvent.setup>,
    buttonName: string,
    payload: (state: string | null) => string,
  ) {
    const popup = popupResult();
    const openMock = vi.spyOn(window, "open").mockReturnValue(popup as never);
    await user.click(screen.getByRole("button", { name: buttonName }));
    const url = await readPopupUrl(popup);
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
    // Nothing is started for a sign-in that cannot open.
    expect(startOAuthFlowMock).not.toHaveBeenCalled();
  });

  it("opens the popup before waiting on the backend, then sends it to the provider", async () => {
    const user = userEvent.setup();
    const popup = popupResult();
    const openMock = vi.spyOn(window, "open").mockReturnValue(popup as never);
    let finishStart: (flow: FlowStart) => void = () => undefined;
    startOAuthFlowMock.mockImplementationOnce(
      () =>
        new Promise<FlowStart>((resolve) => {
          finishStart = resolve;
        }),
    );
    render(<AuthOAuthButtons onError={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(openMock).toHaveBeenCalledWith(
      "about:blank",
      "google-oauth",
      expect.any(String),
    );
    expect(startOAuthFlowMock).toHaveBeenCalledWith("google", "login");
    expect(popup.location.href).toBe("");

    finishStart(serverFlow("google"));
    const url = await readPopupUrl(popup);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("state")).toMatch(/^server-state-google-/);
    expect(url.searchParams.get("nonce")).toMatch(/^server-nonce-google-/);
    expect(url.searchParams.get("code_challenge")).toBe("server-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it.each([
    ["sign-in", {}, "login"],
    ["signup", { intent: "signup" as const }, "signup"],
    ["link", { mode: "link" as const }, "link"],
  ])("starts a %s flow with its intent", async (_label, props, intent) => {
    const user = userEvent.setup();
    vi.spyOn(window, "open").mockReturnValue(popupResult() as never);
    render(<AuthOAuthButtons onError={vi.fn()} {...props} />);

    await user.click(screen.getByRole("button", { name: /Google/ }));

    await waitFor(() =>
      expect(startOAuthFlowMock).toHaveBeenCalledWith("google", intent),
    );
  });

  it("closes the popup and reports a backend that cannot start the sign-in", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const popup = popupResult();
    vi.spyOn(window, "open").mockReturnValue(popup as never);
    startOAuthFlowMock.mockRejectedValueOnce(
      new Error("Too many requests. Please try again later."),
    );
    render(<AuthOAuthButtons onError={onError} />);

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith(
        "Too many requests. Please try again later.",
      ),
    );
    expect(popup.close).toHaveBeenCalled();
    expect(authenticateGoogleMock).not.toHaveBeenCalled();
  });

  it("explains a sign-in the backend no longer recognises", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    authenticateGoogleMock.mockRejectedValue(
      new ApiClientError(
        "This sign-in attempt has expired or was already used. Start again to continue.",
        {
          code: "OAUTH_STATE_INVALID",
          status: 401,
          request: {
            method: "POST",
            path: "/auth/oauth/google",
            requestUrl: "http://localhost:8040/api/v1/auth/oauth/google",
          },
        },
      ),
    );
    render(<AuthOAuthButtons onError={onError} />);

    await openAndRespond(
      user,
      "Continue with Google",
      (state) => `?code=code-1&state=${state}`,
    );

    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith(
        "This sign-in expired or was already used. Please try again.",
      ),
    );
  });

  it("exchanges a verified Google popup code for an authenticated session", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const popup = popupResult();
    vi.spyOn(window, "open").mockReturnValue(popup as never);
    authenticateGoogleMock.mockResolvedValue({ accessToken: "access" });
    render(<AuthOAuthButtons onError={onError} onSuccess={onSuccess} />);

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    const url = await readPopupUrl(popup);
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

    // Only the server's state and the code: the verifier stays on the server.
    await waitFor(() =>
      expect(authenticateGoogleMock).toHaveBeenCalledWith({
        state: url.searchParams.get("state"),
        code: "code-1",
      }),
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

  it("routes an authenticator-protected sign-in to the MFA callback", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onMfaRequired = vi.fn();
    const challenge = {
      mfaRequired: true,
      mfaChallengeToken: "challenge-token",
      availableFactors: ["totp"],
      expiresInSeconds: 300,
    };
    authenticateGoogleMock.mockRejectedValue(
      new ApiClientError("Authenticator code is required.", {
        code: "UNAUTHORIZED",
        status: 401,
        details: challenge,
        request: {
          method: "POST",
          path: "/auth/oauth/google",
          requestUrl: "http://localhost:8040/api/v1/auth/oauth/google",
        },
      }),
    );
    const onError = vi.fn();
    render(
      <AuthOAuthButtons
        onError={onError}
        onSuccess={onSuccess}
        onMfaRequired={onMfaRequired}
      />,
    );

    await openAndRespond(
      user,
      "Continue with Google",
      (state) => `?code=code-1&state=${state}`,
    );

    await waitFor(() => expect(onMfaRequired).toHaveBeenCalledWith(challenge));
    expect(onSuccess).not.toHaveBeenCalled();
    // onError("") clears the previous message when the click starts.
    expect(onError).not.toHaveBeenCalledWith(
      expect.stringMatching(/Authenticator code/),
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
      expect(linkOAuthProviderMock).toHaveBeenCalledWith("google", {
        state: expect.stringMatching(/^server-state-google-/),
        code: "google-code",
      }),
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
    expect(url.searchParams.get("nonce")).toMatch(/^server-nonce-microsoft-/);
    // The browser redeems the code itself, so it brings its own verifier.
    expect(url.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    await waitFor(() =>
      expect(authenticateMicrosoftMock).toHaveBeenCalledWith({
        state: url.searchParams.get("state"),
        idToken: "microsoft-id-token",
      }),
    );
    expect(onSuccess).toHaveBeenCalledWith({ accessToken: "ms-access" });
  });

  it("hands a Microsoft code to the backend when it redeems the code", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    startOAuthFlowMock.mockResolvedValueOnce({
      state: "server-state-ms-code",
      nonce: "server-nonce-ms-code",
      codeChallenge: "server-ms-challenge",
      tokenDelivery: "code",
      expiresInSeconds: 600,
    });
    authenticateMicrosoftMock.mockResolvedValue({ accessToken: "ms-access" });
    render(<AuthOAuthButtons onError={vi.fn()} onSuccess={vi.fn()} />);

    const { url } = await openAndRespond(
      user,
      "Continue with Microsoft",
      (state) => `?code=ms-code&state=${state}`,
    );

    expect(url.searchParams.get("code_challenge")).toBe("server-ms-challenge");
    await waitFor(() =>
      expect(authenticateMicrosoftMock).toHaveBeenCalledWith({
        state: "server-state-ms-code",
        code: "ms-code",
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
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
      const init = vi.fn((config: { state: string; nonce: string }) => {
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
      expect(config.state).toMatch(/^server-state-apple-/);
      expect(config.nonce).toMatch(/^server-nonce-apple-/);
      expect(authenticateAppleMock).toHaveBeenCalledWith({
        state: config.state,
        idToken: "apple-id",
        firstName: "Avery",
        lastName: "Apple",
      });
      expect(onSuccess).toHaveBeenCalledWith({ accessToken: "apple-access" });
    });

    it("sends Apple's code instead when the backend redeems it", async () => {
      const user = userEvent.setup();
      startOAuthFlowMock.mockResolvedValueOnce({
        state: "server-state-apple-code",
        nonce: "server-nonce-apple-code",
        tokenDelivery: "code",
        expiresInSeconds: 600,
      });
      installAppleSdk(async (state) => ({
        authorization: { code: "apple-code", id_token: "apple-id", state },
      }));
      authenticateAppleMock.mockResolvedValue({ accessToken: "apple-access" });
      render(<AuthOAuthButtons onError={vi.fn()} onSuccess={vi.fn()} />);

      await user.click(
        screen.getByRole("button", { name: "Continue with Apple" }),
      );

      await waitFor(() =>
        expect(authenticateAppleMock).toHaveBeenCalledWith({
          state: "server-state-apple-code",
          code: "apple-code",
          firstName: undefined,
          lastName: undefined,
        }),
      );
    });

    it("starts the Apple flow when the user heads for the button, and uses it once", async () => {
      const user = userEvent.setup();
      const { init } = installAppleSdk(async (state) => ({
        authorization: { id_token: "apple-id", state },
      }));
      authenticateAppleMock.mockResolvedValue({ accessToken: "apple-access" });
      render(<AuthOAuthButtons onError={vi.fn()} onSuccess={vi.fn()} />);
      const button = screen.getByRole("button", {
        name: "Continue with Apple",
      });

      fireEvent.pointerEnter(button);
      fireEvent.focus(button);
      expect(startOAuthFlowMock).toHaveBeenCalledTimes(1);
      expect(startOAuthFlowMock).toHaveBeenCalledWith("apple", "login");

      await user.click(button);
      await waitFor(() => expect(authenticateAppleMock).toHaveBeenCalled());
      expect(startOAuthFlowMock).toHaveBeenCalledTimes(1);
      const firstState = init.mock.calls[0]![0].state;

      await user.click(button);
      await waitFor(() =>
        expect(authenticateAppleMock).toHaveBeenCalledTimes(2),
      );
      expect(startOAuthFlowMock).toHaveBeenCalledTimes(2);
      expect(init.mock.calls[1]![0].state).not.toBe(firstState);
    });

    it("retries a prefetched Apple flow that failed", async () => {
      const user = userEvent.setup();
      const onError = vi.fn();
      startOAuthFlowMock.mockRejectedValueOnce(new Error("offline"));
      installAppleSdk(async (state) => ({
        authorization: { id_token: "apple-id", state },
      }));
      authenticateAppleMock.mockResolvedValue({ accessToken: "apple-access" });
      render(<AuthOAuthButtons onError={onError} onSuccess={vi.fn()} />);
      const button = screen.getByRole("button", {
        name: "Continue with Apple",
      });

      fireEvent.pointerEnter(button);
      await waitFor(() => expect(startOAuthFlowMock).toHaveBeenCalledTimes(1));
      await user.click(button);

      await waitFor(() => expect(authenticateAppleMock).toHaveBeenCalled());
      expect(startOAuthFlowMock).toHaveBeenCalledTimes(2);
      expect(onError).not.toHaveBeenCalledWith("offline");
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
        expect(linkOAuthProviderMock).toHaveBeenCalledWith("apple", {
          state: expect.stringMatching(/^server-state-apple-/),
          idToken: "apple-id",
          firstName: undefined,
          lastName: undefined,
        }),
      );
      expect(startOAuthFlowMock).toHaveBeenCalledWith("apple", "link");
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
