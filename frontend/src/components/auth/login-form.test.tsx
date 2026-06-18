import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";
import { ApiClientError, ApiNetworkError } from "@/lib/auth/types";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  useAuthCaptchaTokenMock,
  loginMock,
  authApiRefreshMock,
  clearCaptchaTokenMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useAuthCaptchaTokenMock: vi.fn(),
  loginMock: vi.fn(),
  authApiRefreshMock: vi.fn(),
  clearCaptchaTokenMock: vi.fn(),
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
    refresh: authApiRefreshMock,
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
  AuthOAuthButtons: () => <div>OAuth buttons</div>,
}));

vi.mock("@/components/auth/login-unlock-panel", () => ({
  LoginUnlockPanel: ({ email }: { email: string }) => (
    <div>Unlock panel for {email}</div>
  ),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession: vi.fn(),
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
    });

    render(<LoginForm nextPath="/dashboard" />);

    expect(screen.getByText("Preparing your workspace...")).toBeInTheDocument();
  });

  it("redirects authenticated users immediately", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
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

    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Complete the captcha before signing in."),
    ).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("submits a normalized login request and redirects on success", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn();
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession,
    });
    useAuthCaptchaTokenMock.mockReturnValue([
      "captcha-token",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);
    loginMock.mockResolvedValue({
      accessToken: "access-token",
      device: {
        known: true,
        knownByIp: false,
      },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user",
      },
    });

    render(<LoginForm nextPath="/dashboard" />);

    await user.type(screen.getByLabelText("Email"), " Person@Example.com ");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith({
        email: "person@example.com",
        password: "secret-password",
        captchaToken: "captcha-token",
      });
    });
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalled();
    expect(routerReplaceMock).toHaveBeenCalledWith("/dashboard");
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

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "The email or password you entered is incorrect.",
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

    await user.type(screen.getByLabelText("Email"), "person@example.com");
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

  it("switches to unlock mode for locked-account responses", async () => {
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
      }),
    );

    render(<LoginForm nextPath="/dashboard" />);

    await user.type(screen.getByLabelText("Email"), "person@example.com");
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

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "We couldn't sign you in because we couldn't reach Rentify. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
  });
});
