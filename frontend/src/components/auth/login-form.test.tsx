import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";
import {
  clearPersistedAuthPendingFlow,
  readPersistedAuthPendingFlow,
  writePersistedAuthPendingFlow,
} from "@/lib/auth/pending-flow";
import { ApiClientError, ApiNetworkError } from "@/lib/auth/types";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  useAuthCaptchaTokenMock,
  loginMock,
  clearCaptchaTokenMock,
  verifyDeviceMock,
  logoutMock,
  getOptionsMock,
  oauthSuccessSessionMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useAuthCaptchaTokenMock: vi.fn(),
  loginMock: vi.fn(),
  clearCaptchaTokenMock: vi.fn(),
  verifyDeviceMock: vi.fn(),
  logoutMock: vi.fn(),
  getOptionsMock: vi.fn(),
  oauthSuccessSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/auth/captcha-store", () => ({
  useAuthCaptchaToken: useAuthCaptchaTokenMock,
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    login: loginMock,
    logout: logoutMock,
    verifyDevice: verifyDeviceMock,
  },
}));

vi.mock("@/lib/auth/mfa-verification-api", () => ({
  mfaVerificationApi: {
    getOptions: getOptionsMock,
  },
}));

vi.mock("@/components/auth/auth-captcha-panel", () => ({
  AuthCaptchaPanel: ({ token, error }: { token: string; error?: string }) => (
    <div>
      <div>Captcha token: {token || "empty"}</div>
      {error ? <p>{error}</p> : null}
    </div>
  ),
}));

vi.mock("@/components/auth/oauth-buttons", () => ({
  AuthOAuthButtons: ({
    onSuccess,
  }: {
    onSuccess: (session: unknown) => void;
  }) => (
    <button type="button" onClick={() => onSuccess(oauthSuccessSessionMock())}>
      Trigger OAuth success
    </button>
  ),
}));

vi.mock("@/components/auth/oauth-welcome-modal", () => ({
  OAuthWelcomeModal: ({
    open,
    username,
  }: {
    open: boolean;
    username: string;
  }) => (open ? <div>Welcome modal for {username}</div> : null),
}));

vi.mock("@/components/auth/login-unlock-panel", () => ({
  LoginUnlockPanel: ({ email }: { email: string }) => (
    <div>Unlock panel for {email}</div>
  ),
}));

vi.mock("@/components/auth/mfa-verification-dialog", () => ({
  MfaVerificationDialog: ({
    initialChallengeSent,
    onCodeEntryStateChange,
    onVerified,
    onCancel,
    preferredFactor,
  }: {
    initialChallengeSent?: boolean;
    onCodeEntryStateChange?: (
      state: {
        challengeSent: boolean;
        selectedFactor: "email" | "sms" | "totp";
      } | null,
    ) => void;
    onVerified: (result: unknown) => void;
    onCancel: () => void;
    preferredFactor?: "email" | "sms" | "totp" | null;
  }) => (
    <div>
      <div>MFA dialog</div>
      <button
        type="button"
        onClick={() =>
          onCodeEntryStateChange?.({
            challengeSent: initialChallengeSent ?? true,
            selectedFactor: preferredFactor ?? "email",
          })
        }
      >
        Persist device MFA state
      </button>
      <button type="button" onClick={() => onCodeEntryStateChange?.(null)}>
        Clear device MFA state
      </button>
      <button type="button" onClick={() => onVerified({})}>
        Verify device MFA
      </button>
      <button type="button" onClick={onCancel}>
        Cancel device MFA
      </button>
    </div>
  ),
}));

describe("LoginForm", () => {
  function clientError(
    status: number,
    code: string,
    message = "Request failed",
    details?: unknown,
  ) {
    return new ApiClientError(message, {
      code,
      status,
      details,
      request: {
        method: "POST",
        path: "/auth/local/login",
        requestUrl: "http://localhost:8040/api/v1/auth/local/login",
      },
    });
  }

  function loginSession(
    device: { known: boolean; knownByIp: boolean } = {
      known: true,
      knownByIp: false,
    },
  ) {
    return {
      accessToken: "access-token",
      device,
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user" as const,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    clearPersistedAuthPendingFlow();
    logoutMock.mockResolvedValue(undefined);
    verifyDeviceMock.mockResolvedValue(undefined);
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession: vi.fn(),
      clearSession: vi.fn(),
    });
    useAuthCaptchaTokenMock.mockReturnValue([
      "captcha-token",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);
  });

  it("shows a loading state while auth status is loading", () => {
    useAuthMock.mockReturnValue({
      status: "loading",
      setSession: vi.fn(),
      clearSession: vi.fn(),
    });

    render(<LoginForm nextPath="/dashboard" />);

    expect(screen.getByText("Preparing your workspace...")).toBeInTheDocument();
  });

  it("redirects authenticated users immediately", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
      clearSession: vi.fn(),
    });

    render(<LoginForm nextPath="/dashboard" />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("shows validation errors for missing form values", async () => {
    const user = userEvent.setup();
    useAuthCaptchaTokenMock.mockReturnValue([
      "",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);

    render(<LoginForm nextPath="/dashboard" />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Username is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Complete the captcha before signing in."),
    ).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("validates malformed usernames and toggles password visibility", async () => {
    const user = userEvent.setup();
    render(<LoginForm nextPath="/dashboard" />);

    await user.type(screen.getByLabelText("Username"), "bad username!");
    await user.type(screen.getByLabelText("Password"), "secret");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      screen.getByText(
        "Use 3-50 letters, numbers, periods, underscores, or hyphens.",
      ),
    ).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("submits a normalized login request and redirects on success", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn().mockImplementation(() => {
      useAuthMock.mockReturnValue({
        status: "authenticated",
        setSession,
        clearSession: vi.fn(),
      });
    });
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession,
      clearSession: vi.fn(),
    });
    useAuthCaptchaTokenMock.mockReturnValue([
      "captcha-token",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);
    loginMock.mockResolvedValue({
      accessToken: "access-token",
      device: {
        known: false,
        knownByIp: false,
      },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user",
      },
    });
    getOptionsMock.mockResolvedValue({
      scope: "device-login",
      verified: true,
      verifiedUntil: null,
      availableFactors: [],
      recommendedFactor: null,
    });

    render(<LoginForm nextPath="/dashboard" />);

    await user.type(screen.getByLabelText("Username"), " Person ");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith({
        username: "person",
        password: "secret-password",
        captchaToken: "captcha-token",
      });
    });
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalled();
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("opens the welcome modal and defers redirect for a first-time OAuth user", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn().mockImplementation(() => {
      useAuthMock.mockReturnValue({
        status: "authenticated",
        setSession,
        clearSession: vi.fn(),
      });
    });
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession,
      clearSession: vi.fn(),
    });
    oauthSuccessSessionMock.mockReturnValue({
      accessToken: "access-token",
      isNewUser: true,
      device: { known: true, knownByIp: true },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person.generated",
        role: "user",
      },
    });

    render(<LoginForm nextPath="/dashboard" />);

    await user.click(
      screen.getByRole("button", { name: "Trigger OAuth success" }),
    );

    expect(
      await screen.findByText("Welcome modal for person.generated"),
    ).toBeInTheDocument();
    expect(setSession).toHaveBeenCalled();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("redirects a returning OAuth user without showing the welcome modal", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn().mockImplementation(() => {
      useAuthMock.mockReturnValue({
        status: "authenticated",
        setSession,
        clearSession: vi.fn(),
      });
    });
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession,
      clearSession: vi.fn(),
    });
    oauthSuccessSessionMock.mockReturnValue({
      accessToken: "access-token",
      device: { known: true, knownByIp: true },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user",
      },
    });

    const { rerender } = render(<LoginForm nextPath="/dashboard" />);

    await user.click(
      screen.getByRole("button", { name: "Trigger OAuth success" }),
    );

    // The real AuthProvider re-renders consumers once the session is stored;
    // simulate that propagation so the authenticated-redirect effect runs.
    rerender(<LoginForm nextPath="/dashboard" />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/dashboard");
    });
    expect(screen.queryByText(/Welcome modal for/)).not.toBeInTheDocument();
  });

  it("maps invalid credential failures to a friendly message", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(
      new ApiClientError("Unauthorized", {
        code: "INVALID_CREDENTIALS",
        request: {
          method: "POST",
          path: "/auth/local/login",
          requestUrl: "http://localhost:8040/api/v1/auth/local/login",
        },
        status: 401,
      }),
    );

    render(<LoginForm nextPath="/dashboard" />);

    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "The username or password you entered is incorrect.",
      ),
    ).toBeInTheDocument();
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
  });

  it("maps captcha failures to field-level messaging", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(
      new ApiClientError("Captcha verification failed.", {
        code: "CAPTCHA_INVALID",
        request: {
          method: "POST",
          path: "/auth/local/login",
          requestUrl: "http://localhost:8040/api/v1/auth/local/login",
        },
        status: 400,
      }),
    );

    render(<LoginForm nextPath="/dashboard" />);

    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "The security check expired or failed. Please try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please complete the verification again."),
    ).toBeInTheDocument();
  });

  it.each([
    [
      clientError(400, "CAPTCHA_REQUIRED"),
      "Please complete the security check before signing in.",
      "Complete the verification to continue.",
    ],
    [
      clientError(400, "VALIDATION_ERROR", "Correct the highlighted fields"),
      "Correct the highlighted fields",
      null,
    ],
    [
      clientError(400, "OTHER_BAD_REQUEST", "Malformed login"),
      "Malformed login",
      null,
    ],
    [
      clientError(409, "EMAIL_NOT_VERIFIED", "Verify first"),
      "Your account has not been verified yet. Please verify your email before signing in.",
      null,
    ],
    [
      clientError(409, "AUTH_PROVIDER_MISMATCH", "Use Google"),
      "This account uses a different sign-in method. Use the original provider you signed up with.",
      null,
    ],
    [
      clientError(409, "ACCOUNT_DISABLED", "Account disabled"),
      "This account is currently unavailable. Please contact support if you believe this is a mistake.",
      null,
    ],
    [
      clientError(423, "LOGIN_LOCKED", "Temporarily locked"),
      "Temporarily locked",
      null,
    ],
  ])("maps login failure %#", async (error, general, field) => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(error);
    render(<LoginForm nextPath="/dashboard" />);
    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText(general)).toBeInTheDocument();
    if (field) expect(screen.getByText(field)).toBeInTheDocument();
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
  });

  it("verifies MFA for a new device before completing login", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn();
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession,
      clearSession: vi.fn(),
    });
    loginMock.mockResolvedValue(loginSession({ known: false, knownByIp: false }));
    getOptionsMock.mockResolvedValue({
      scope: "device-login",
      verified: false,
      verifiedUntil: null,
      availableFactors: ["sms"],
      recommendedFactor: "sms",
    });
    render(<LoginForm nextPath="/dashboard" />);
    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("MFA dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Verify device MFA" }));

    await waitFor(() => expect(verifyDeviceMock).toHaveBeenCalled());
    expect(setSession).toHaveBeenCalled();
  });

  it("cancels MFA for a new device and logs the provisional session out", async () => {
    const user = userEvent.setup();
    loginMock.mockResolvedValue(loginSession({ known: false, knownByIp: false }));
    getOptionsMock.mockResolvedValue({
      scope: "device-login",
      verified: false,
      verifiedUntil: null,
      availableFactors: ["email"],
      recommendedFactor: "email",
    });
    render(<LoginForm nextPath="/dashboard" />);
    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(await screen.findByRole("button", { name: "Cancel device MFA" }));

    expect(await screen.findByText("Sign-in was cancelled. Please try again.")).toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalled();
  });

  it("accepts already-verified MFA options and verifies IP-known devices", async () => {
    const user = userEvent.setup();
    loginMock.mockResolvedValueOnce(loginSession({ known: false, knownByIp: false }));
    getOptionsMock.mockResolvedValueOnce({
      scope: "device-login",
      verified: true,
      verifiedUntil: "2026-08-09T00:00:00.000Z",
      availableFactors: ["totp"],
      recommendedFactor: "totp",
    });
    const { unmount } = render(<LoginForm nextPath="/dashboard" />);
    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(verifyDeviceMock).toHaveBeenCalled());
    unmount();

    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ status: "anonymous", setSession: vi.fn(), clearSession: vi.fn() });
    useAuthCaptchaTokenMock.mockReturnValue(["captcha-token", vi.fn(), clearCaptchaTokenMock]);
    loginMock.mockResolvedValue(loginSession({ known: false, knownByIp: true }));
    render(<LoginForm nextPath="/dashboard" />);
    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(verifyDeviceMock).toHaveBeenCalled());
    expect(getOptionsMock).not.toHaveBeenCalled();
  });

  it("continues login when MFA option discovery fails", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn();
    useAuthMock.mockReturnValue({ status: "anonymous", setSession, clearSession: vi.fn() });
    loginMock.mockResolvedValue(loginSession({ known: false, knownByIp: false }));
    getOptionsMock.mockRejectedValue(new Error("MFA unavailable"));
    render(<LoginForm nextPath="/dashboard" />);
    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(setSession).toHaveBeenCalled());
    expect(screen.queryByText("MFA dialog")).not.toBeInTheDocument();
  });

  it("switches to unlock mode for locked-account responses with a resolved email", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(
      new ApiClientError("Locked", {
        code: "LOGIN_LOCKED",
        request: {
          method: "POST",
          path: "/auth/local/login",
          requestUrl: "http://localhost:8040/api/v1/auth/local/login",
        },
        status: 423,
        details: {
          email: "person@example.com",
          unlockRequired: true,
        },
      }),
    );

    render(<LoginForm nextPath="/dashboard" />);

    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Unlock panel for person@example.com"),
    ).toBeInTheDocument();
  });

  it("shows a shared network message when sign-in cannot reach the api", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(
      new ApiNetworkError("Unable to reach the server.", {
        code: "NETWORK_ERROR",
        request: {
          method: "POST",
          path: "/auth/local/login",
          requestUrl: "http://localhost:8040/api/v1/auth/local/login",
        },
      }),
    );

    render(<LoginForm nextPath="/dashboard" />);

    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "We couldn't sign you in because we couldn't reach Rentify. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("restores device-login MFA and finishes sign-in after verification", async () => {
    const user = userEvent.setup();
    const clearSession = vi.fn();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
      clearSession,
    });
    writePersistedAuthPendingFlow({
      flow: "device-login-mfa",
      nextPath: "/dashboard",
      selectedFactor: "email",
      challengeSent: true,
    });
    getOptionsMock.mockResolvedValue({
      scope: "device-login",
      verified: false,
      verifiedUntil: null,
      availableFactors: ["email"],
      recommendedFactor: "email",
    });

    render(<LoginForm nextPath="/dashboard" />);

    expect(await screen.findByText("MFA dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Verify device MFA" }));

    await waitFor(() => {
      expect(verifyDeviceMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/dashboard");
    });
    expect(readPersistedAuthPendingFlow()).toBeNull();
    expect(clearSession).not.toHaveBeenCalled();
  });

  it("handles restored MFA cancellation and post-verification failure", async () => {
    const user = userEvent.setup();
    const clearSession = vi.fn();
    useAuthMock.mockReturnValue({ status: "authenticated", setSession: vi.fn(), clearSession });
    writePersistedAuthPendingFlow({
      flow: "device-login-mfa",
      nextPath: "/dashboard",
      selectedFactor: "email",
      challengeSent: false,
    });
    getOptionsMock.mockResolvedValue({
      scope: "device-login",
      verified: false,
      verifiedUntil: null,
      availableFactors: ["email"],
      recommendedFactor: "email",
    });
    const { unmount, rerender } = render(<LoginForm nextPath="/dashboard" />);
    await user.click(await screen.findByRole("button", { name: "Cancel device MFA" }));
    await waitFor(() => expect(clearSession).toHaveBeenCalled());
    useAuthMock.mockReturnValue({ status: "anonymous", setSession: vi.fn(), clearSession });
    rerender(<LoginForm nextPath="/dashboard" />);
    expect(screen.getByText("Sign-in was cancelled. Please try again.")).toBeInTheDocument();
    unmount();

    clearPersistedAuthPendingFlow();
    writePersistedAuthPendingFlow({
      flow: "device-login-mfa",
      nextPath: "/dashboard",
      selectedFactor: "email",
      challengeSent: true,
    });
    clearSession.mockClear();
    verifyDeviceMock.mockRejectedValue(new Error("verify failed"));
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
      clearSession,
    });
    const second = render(<LoginForm nextPath="/dashboard" />);
    await user.click(await screen.findByRole("button", { name: "Verify device MFA" }));
    await waitFor(() => expect(clearSession).toHaveBeenCalled());
    useAuthMock.mockReturnValue({ status: "anonymous", setSession: vi.fn(), clearSession });
    second.rerender(<LoginForm nextPath="/dashboard" />);
    expect(
      await screen.findByText(
        "We verified your code, but couldn't finish this sign-in. Please try again.",
      ),
    ).toBeInTheDocument();
    expect(clearSession).toHaveBeenCalled();
  });

  it("does not rewrite identical restored device-login MFA state", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
      clearSession: vi.fn(),
    });
    writePersistedAuthPendingFlow({
      flow: "device-login-mfa",
      nextPath: "/dashboard",
      selectedFactor: "email",
      challengeSent: true,
    });
    getOptionsMock.mockResolvedValue({
      scope: "device-login",
      verified: false,
      verifiedUntil: null,
      availableFactors: ["email"],
      recommendedFactor: "email",
    });

    render(<LoginForm nextPath="/dashboard" />);

    expect(await screen.findByText("MFA dialog")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Persist device MFA state" }),
    );

    expect(readPersistedAuthPendingFlow()).toEqual({
      flow: "device-login-mfa",
      nextPath: "/dashboard",
      selectedFactor: "email",
      challengeSent: true,
    });
    expect(getOptionsMock).toHaveBeenCalledTimes(1);
  });

  it("opens the account recovery dialog from the password help trigger", async () => {
    const user = userEvent.setup();

    render(<LoginForm nextPath="/dashboard" />);

    await user.click(screen.getByRole("button", { name: "I can't log in" }));

    expect(
      await screen.findByRole("heading", { name: "I can't log in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /I forgot my username/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /I forgot my password/i }),
    ).toBeInTheDocument();
  });

  it("opens the account recovery dialog when the page requests it", async () => {
    render(<LoginForm nextPath="/dashboard" initialRecoveryOpen />);

    expect(
      await screen.findByRole("heading", { name: "I can't log in" }),
    ).toBeInTheDocument();
  });
});
