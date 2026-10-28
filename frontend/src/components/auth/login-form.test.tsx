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
  completeLoginMfaMock,
  oauthMfaRequiredMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useAuthCaptchaTokenMock: vi.fn(),
  loginMock: vi.fn(),
  clearCaptchaTokenMock: vi.fn(),
  verifyDeviceMock: vi.fn(),
  logoutMock: vi.fn(),
  getOptionsMock: vi.fn(),
  oauthSuccessSessionMock: vi.fn(),
  completeLoginMfaMock: vi.fn(),
  oauthMfaRequiredMock: vi.fn(),
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
    completeLoginMfa: completeLoginMfaMock,
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
    onMfaRequired,
  }: {
    onSuccess: (session: unknown) => void;
    onMfaRequired?: (result: unknown) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() => onSuccess(oauthSuccessSessionMock())}
      >
        Trigger OAuth success
      </button>
      <button
        type="button"
        onClick={() => onMfaRequired?.(oauthMfaRequiredMock())}
      >
        Trigger OAuth MFA
      </button>
    </>
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

  it("redirects to / instead of an off-site next path", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
      clearSession: vi.fn(),
    });

    render(<LoginForm nextPath="https://example.org" />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/");
    });
    expect(routerReplaceMock).not.toHaveBeenCalledWith("https://example.org");
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
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
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
    loginMock.mockResolvedValue(
      loginSession({ known: false, knownByIp: false }),
    );
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
    loginMock.mockResolvedValue(
      loginSession({ known: false, knownByIp: false }),
    );
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
    await user.click(
      await screen.findByRole("button", { name: "Cancel device MFA" }),
    );

    expect(
      await screen.findByText("Sign-in was cancelled. Please try again."),
    ).toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalled();
  });

  it("accepts already-verified MFA options and verifies IP-known devices", async () => {
    const user = userEvent.setup();
    loginMock.mockResolvedValueOnce(
      loginSession({ known: false, knownByIp: false }),
    );
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
    loginMock.mockResolvedValue(
      loginSession({ known: false, knownByIp: true }),
    );
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
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession,
      clearSession: vi.fn(),
    });
    loginMock.mockResolvedValue(
      loginSession({ known: false, knownByIp: false }),
    );
    getOptionsMock.mockRejectedValue(new Error("MFA unavailable"));
    render(<LoginForm nextPath="/dashboard" />);
    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(setSession).toHaveBeenCalled());
    expect(screen.queryByText("MFA dialog")).not.toBeInTheDocument();
  });

  it("sends a security hold to password reset instead of the unlock code", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(
      clientError(
        423,
        "ACCOUNT_LOCKED",
        "This account is on a security hold. Reset your password to recover it.",
        { reason: "security_hold", recovery: "password_reset" },
      ),
    );
    render(<LoginForm nextPath="/dashboard" />);

    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "This account is on a security hold to protect it. Reset your password to get back in.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Unlock panel/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Reset your password" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Reset password" }),
    ).toBeInTheDocument();
  });

  it("tells a suspended account to contact support, with no reset offered", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(
      clientError(403, "ACCOUNT_SUSPENDED", "This account has been suspended."),
    );
    render(<LoginForm nextPath="/dashboard" />);

    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "This account has been suspended. Contact support if you believe this is a mistake.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reset your password" }),
    ).not.toBeInTheDocument();
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
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
      clearSession,
    });
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
    await user.click(
      await screen.findByRole("button", { name: "Cancel device MFA" }),
    );
    await waitFor(() => expect(clearSession).toHaveBeenCalled());
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession: vi.fn(),
      clearSession,
    });
    rerender(<LoginForm nextPath="/dashboard" />);
    expect(
      screen.getByText("Sign-in was cancelled. Please try again."),
    ).toBeInTheDocument();
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
    await user.click(
      await screen.findByRole("button", { name: "Verify device MFA" }),
    );
    await waitFor(() => expect(clearSession).toHaveBeenCalled());
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession: vi.fn(),
      clearSession,
    });
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

  describe("authenticator step", () => {
    const challenge = {
      mfaRequired: true as const,
      mfaChallengeToken: "challenge-token",
      availableFactors: ["totp" as const],
      expiresInSeconds: 300,
    };

    function challengeError() {
      return new ApiClientError("Authenticator code is required.", {
        code: "UNAUTHORIZED",
        status: 401,
        details: challenge,
        request: {
          method: "POST",
          path: "/auth/local/login",
          requestUrl: "http://localhost:8040/api/v1/auth/local/login",
        },
      });
    }

    function mfaError(status: number, code: string, details?: unknown) {
      return new ApiClientError("Request failed", {
        code,
        status,
        details,
        request: {
          method: "POST",
          path: "/auth/login/mfa",
          requestUrl: "http://localhost:8040/api/v1/auth/login/mfa",
        },
      });
    }

    function authenticateOnSetSession() {
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
      return setSession;
    }

    async function signInWithPassword(
      user: ReturnType<typeof userEvent.setup>,
    ) {
      await user.type(screen.getByLabelText("Username"), "person");
      await user.type(screen.getByLabelText("Password"), "secret-password");
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      return screen.findByLabelText("Authenticator code");
    }

    it("asks for the code after a correct password, then signs in with it", async () => {
      const user = userEvent.setup();
      const setSession = authenticateOnSetSession();
      loginMock.mockRejectedValue(challengeError());
      completeLoginMfaMock.mockResolvedValue(
        loginSession({ known: false, knownByIp: false }),
      );
      getOptionsMock.mockResolvedValue({
        scope: "device-login",
        verified: true,
        verifiedUntil: null,
        availableFactors: ["totp"],
        recommendedFactor: "totp",
      });

      render(<LoginForm nextPath="/dashboard" />);

      const codeInput = await signInWithPassword(user);
      expect(readPersistedAuthPendingFlow()).toMatchObject({
        flow: "login-mfa",
        mfaChallengeToken: "challenge-token",
        method: "password",
        factor: "totp",
        nextPath: "/dashboard",
      });
      expect(JSON.stringify(readPersistedAuthPendingFlow())).not.toContain(
        "secret-password",
      );
      expect(
        screen.queryByRole("button", { name: /different method/i }),
      ).not.toBeInTheDocument();

      await user.type(codeInput, "12a3 456");
      await user.click(
        screen.getByRole("button", { name: "Verify and sign in" }),
      );

      await waitFor(() => {
        expect(completeLoginMfaMock).toHaveBeenCalledWith({
          mfaChallengeToken: "challenge-token",
          factor: "totp",
          code: "123456",
        });
      });
      expect(setSession).toHaveBeenCalled();
      // The code that signed in already covers the new-device check.
      await waitFor(() => {
        expect(verifyDeviceMock).toHaveBeenCalled();
      });
      expect(readPersistedAuthPendingFlow()).toBeNull();
      await waitFor(() => {
        expect(routerReplaceMock).toHaveBeenCalledWith("/dashboard");
      });
    });

    it("rejects a short code without calling the api", async () => {
      const user = userEvent.setup();
      loginMock.mockRejectedValue(challengeError());

      render(<LoginForm nextPath="/dashboard" />);

      const codeInput = await signInWithPassword(user);
      await user.type(codeInput, "123");
      await user.click(
        screen.getByRole("button", { name: "Verify and sign in" }),
      );

      expect(
        screen.getByText("Enter the 6-digit code from your authenticator app."),
      ).toBeInTheDocument();
      expect(completeLoginMfaMock).not.toHaveBeenCalled();
    });

    it("keeps the step open with an error for a wrong code", async () => {
      const user = userEvent.setup();
      loginMock.mockRejectedValue(challengeError());
      completeLoginMfaMock.mockRejectedValue(mfaError(400, "INVALID_MFA_CODE"));

      render(<LoginForm nextPath="/dashboard" />);

      const codeInput = await signInWithPassword(user);
      await user.type(codeInput, "000000");
      await user.click(
        screen.getByRole("button", { name: "Verify and sign in" }),
      );

      expect(
        await screen.findByText(
          "That code is incorrect. Check your authenticator app and try again.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Authenticator code")).toHaveValue("");
      expect(readPersistedAuthPendingFlow()).toMatchObject({
        flow: "login-mfa",
      });
    });

    it("returns to the form when the challenge expired or was used", async () => {
      const user = userEvent.setup();
      loginMock.mockRejectedValue(challengeError());
      completeLoginMfaMock.mockRejectedValue(
        mfaError(401, "MFA_CHALLENGE_INVALID"),
      );

      render(<LoginForm nextPath="/dashboard" />);

      const codeInput = await signInWithPassword(user);
      await user.type(codeInput, "123456");
      await user.click(
        screen.getByRole("button", { name: "Verify and sign in" }),
      );

      expect(
        await screen.findByText("Your sign-in expired. Please sign in again."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
      expect(readPersistedAuthPendingFlow()).toBeNull();
    });

    it("switches to the unlock panel when the wrong code set the lock", async () => {
      const user = userEvent.setup();
      loginMock.mockRejectedValue(challengeError());
      completeLoginMfaMock.mockRejectedValue(
        mfaError(423, "ACCOUNT_LOCKED", {
          email: "person@example.com",
          unlockRequired: true,
        }),
      );

      render(<LoginForm nextPath="/dashboard" />);

      const codeInput = await signInWithPassword(user);
      await user.type(codeInput, "000000");
      await user.click(
        screen.getByRole("button", { name: "Verify and sign in" }),
      );

      expect(
        await screen.findByText("Unlock panel for person@example.com"),
      ).toBeInTheDocument();
      expect(readPersistedAuthPendingFlow()).toMatchObject({
        flow: "login-unlock",
      });
    });

    it("shows a retryable error when the code cannot be checked", async () => {
      const user = userEvent.setup();
      loginMock.mockRejectedValue(challengeError());
      completeLoginMfaMock.mockRejectedValue(
        new ApiNetworkError("Network down", {
          code: "NETWORK_ERROR",
          request: {
            method: "POST",
            path: "/auth/login/mfa",
            requestUrl: "http://localhost:8040/api/v1/auth/login/mfa",
          },
        }),
      );

      render(<LoginForm nextPath="/dashboard" />);

      const codeInput = await signInWithPassword(user);
      await user.type(codeInput, "123456");
      await user.click(
        screen.getByRole("button", { name: "Verify and sign in" }),
      );

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(screen.getByLabelText("Authenticator code")).toBeInTheDocument();
    });

    it("goes back to the form and drops the challenge on cancel", async () => {
      const user = userEvent.setup();
      loginMock.mockRejectedValue(challengeError());

      render(<LoginForm nextPath="/dashboard" />);

      await signInWithPassword(user);
      await user.click(screen.getByRole("button", { name: "Back to sign in" }));

      expect(screen.getByLabelText("Password")).toHaveValue("");
      expect(readPersistedAuthPendingFlow()).toBeNull();
    });

    it("restores the code step after a refresh", async () => {
      writePersistedAuthPendingFlow({
        flow: "login-mfa",
        mfaChallengeToken: "restored-token",
        availableFactors: ["totp"],
        factor: "totp",
        method: "password",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        nextPath: "/dashboard",
      });

      render(<LoginForm nextPath="/dashboard" />);

      expect(
        await screen.findByLabelText("Authenticator code"),
      ).toBeInTheDocument();
    });

    it("drops an expired restored step and says so", async () => {
      writePersistedAuthPendingFlow({
        flow: "login-mfa",
        mfaChallengeToken: "stale-token",
        availableFactors: ["totp"],
        factor: "totp",
        method: "password",
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        nextPath: "/dashboard",
      });

      render(<LoginForm nextPath="/dashboard" />);

      expect(
        await screen.findByText("Your sign-in expired. Please sign in again."),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Authenticator code")).toBeNull();
      expect(readPersistedAuthPendingFlow()).toBeNull();
    });

    it("drops a pending step once the user is signed in elsewhere", async () => {
      useAuthMock.mockReturnValue({
        status: "authenticated",
        setSession: vi.fn(),
        clearSession: vi.fn(),
      });
      writePersistedAuthPendingFlow({
        flow: "login-mfa",
        mfaChallengeToken: "other-tab-token",
        availableFactors: ["totp"],
        factor: "totp",
        method: "password",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        nextPath: "/dashboard",
      });

      render(<LoginForm nextPath="/dashboard" />);

      await waitFor(() => {
        expect(readPersistedAuthPendingFlow()).toBeNull();
      });
      await waitFor(() => {
        expect(routerReplaceMock).toHaveBeenCalledWith("/dashboard");
      });
    });

    it("finishes an OAuth sign-in that needs a code as an OAuth sign-in", async () => {
      const user = userEvent.setup();
      const setSession = authenticateOnSetSession();
      oauthMfaRequiredMock.mockReturnValue(challenge);
      completeLoginMfaMock.mockResolvedValue(
        loginSession({ known: false, knownByIp: false }),
      );

      render(<LoginForm nextPath="/dashboard" />);

      await user.click(
        screen.getByRole("button", { name: "Trigger OAuth MFA" }),
      );
      expect(readPersistedAuthPendingFlow()).toMatchObject({
        flow: "login-mfa",
        method: "oauth",
      });

      await user.type(
        await screen.findByLabelText("Authenticator code"),
        "123456",
      );
      await user.click(
        screen.getByRole("button", { name: "Verify and sign in" }),
      );

      await waitFor(() => {
        expect(setSession).toHaveBeenCalled();
      });
      // OAuth sign-ins register the device without the device-login check.
      expect(getOptionsMock).not.toHaveBeenCalled();
      expect(verifyDeviceMock).toHaveBeenCalled();
    });
  });
});
