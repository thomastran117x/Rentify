import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";
import { writePersistedAuthPendingFlow } from "@/lib/auth/pending-flow";
import { ApiClientError } from "@/lib/auth/types";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  useAuthCaptchaTokenMock,
  forgotPasswordMock,
  resetPasswordMock,
  resendForgotPasswordMock,
  clearCaptchaTokenMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useAuthCaptchaTokenMock: vi.fn(),
  forgotPasswordMock: vi.fn(),
  resetPasswordMock: vi.fn(),
  resendForgotPasswordMock: vi.fn(),
  clearCaptchaTokenMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/auth/captcha-store", () => ({
  useAuthCaptchaToken: useAuthCaptchaTokenMock,
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    forgotPassword: forgotPasswordMock,
    resetPassword: resetPasswordMock,
    resendForgotPassword: resendForgotPasswordMock,
  },
}));

vi.mock("@/components/auth/auth-captcha-panel", () => ({
  AuthCaptchaPanel: ({
    token,
    error,
    stale,
    staleMessage,
    onChange,
    onReset,
  }: {
    token: string;
    error?: string;
    stale?: boolean;
    staleMessage?: string;
    onChange: (token: string) => void;
    onReset: () => void;
  }) => (
    <div>
      <div>Captcha token: {token || "empty"}</div>
      {stale && staleMessage ? <p>{staleMessage}</p> : null}
      {error ? <p>{error}</p> : null}
      <button type="button" onClick={() => onChange("fresh-captcha-token")}>
        Complete captcha
      </button>
      <button type="button" onClick={onReset}>
        Reset captcha
      </button>
    </div>
  ),
}));

function clientError(
  status: number,
  code: string,
  message = "Request failed",
  details?: unknown,
) {
  return new ApiClientError(message, {
    status,
    code,
    details,
    request: {
      method: "POST",
      path: "/auth/forgot-password",
      requestUrl: "/api/auth/forgot-password",
    },
  });
}

describe("ForgotPasswordForm", () => {
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

  it("shows request validation errors", async () => {
    const user = userEvent.setup();
    useAuthCaptchaTokenMock.mockReturnValue([
      "",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);

    render(<ForgotPasswordForm />);

    await user.click(screen.getByRole("button", { name: "Send reset code" }));

    expect(screen.getByText("Username is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Complete the captcha before continuing."),
    ).toBeInTheDocument();
    expect(forgotPasswordMock).not.toHaveBeenCalled();
  });

  it("validates malformed usernames before requesting a reset", async () => {
    const user = userEvent.setup();

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Username"), "bad username!");
    await user.click(screen.getByRole("button", { name: "Send reset code" }));

    expect(
      screen.getByText(
        "Use 3-50 letters, numbers, periods, underscores, or hyphens.",
      ),
    ).toBeInTheDocument();
    expect(forgotPasswordMock).not.toHaveBeenCalled();
  });

  it("renders while auth state loads and redirects authenticated users", async () => {
    const { rerender } = render(<ForgotPasswordForm />);

    useAuthMock.mockReturnValue({ status: "loading", setSession: vi.fn() });
    rerender(<ForgotPasswordForm />);
    expect(screen.getByText("Preparing your workspace...")).toBeInTheDocument();

    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
    });
    rerender(<ForgotPasswordForm />);
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/"));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("maps captcha request failures and clears the consumed token", async () => {
    const user = userEvent.setup();
    forgotPasswordMock.mockRejectedValue(
      clientError(400, "CAPTCHA_EXPIRED", "Captcha expired"),
    );

    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Username"), "person");
    await user.click(screen.getByRole("button", { name: "Send reset code" }));

    expect(
      await screen.findByText(
        "The security check expired or failed. Please try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please complete the verification again."),
    ).toBeInTheDocument();
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
  });

  it("uses the server message for other bad reset requests", async () => {
    const user = userEvent.setup();
    forgotPasswordMock.mockRejectedValue(
      clientError(400, "INVALID_USERNAME", "That username is unavailable"),
    );

    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Username"), "person");
    await user.click(screen.getByRole("button", { name: "Send reset code" }));

    expect(
      await screen.findByText("That username is unavailable"),
    ).toBeInTheDocument();
  });

  it("moves to reset mode after requesting a reset code", async () => {
    const user = userEvent.setup();
    forgotPasswordMock.mockResolvedValue({ accepted: true });

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Username"), " Person ");
    await user.click(screen.getByRole("button", { name: "Send reset code" }));

    await screen.findByText("Check your inbox");
    expect(forgotPasswordMock).toHaveBeenCalledWith({
      username: "person",
      captchaToken: "captcha-token",
    });
    expect(clearCaptchaTokenMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "This verification was used for your last request. Run it again before requesting another reset code.",
      ),
    ).toBeInTheDocument();
  });

  it("resets the password, stores the session, and redirects", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn();
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession,
    });
    forgotPasswordMock.mockResolvedValue({ accepted: true });
    resetPasswordMock.mockResolvedValue({
      accessToken: "access-token",
      device: { known: true, knownByIp: false },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user",
      },
    });

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Username"), "person");
    await user.click(screen.getByRole("button", { name: "Send reset code" }));
    await screen.findByText("Check your inbox");

    await user.type(screen.getByLabelText("Reset code"), "123456");
    await user.type(screen.getByLabelText("New password"), "password123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(resetPasswordMock).toHaveBeenCalledWith({
        username: "person",
        code: "123456",
        newPassword: "password123",
      });
    });
    expect(setSession).toHaveBeenCalled();
    expect(routerReplaceMock).toHaveBeenCalledWith("/");
  });

  it("requires rerunning captcha before resending a reset code", async () => {
    const user = userEvent.setup();
    forgotPasswordMock.mockResolvedValue({ accepted: true });
    resendForgotPasswordMock.mockResolvedValue({ accepted: true });

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Username"), "person");
    await user.click(screen.getByRole("button", { name: "Send reset code" }));
    await screen.findByText("Check your inbox");

    await user.click(screen.getByRole("button", { name: "Resend reset code" }));

    expect(resendForgotPasswordMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Run the verification again before requesting another reset code.",
      ),
    ).toBeInTheDocument();
  });

  it("validates reset codes and both password fields", async () => {
    const user = userEvent.setup();
    writePersistedAuthPendingFlow({
      flow: "forgot-password-reset",
      username: "person",
    });

    render(<ForgotPasswordForm />);
    await screen.findByText("Check your inbox");
    await user.type(screen.getByLabelText("Reset code"), "12a3");
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm new password"), "different");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      screen.getByText("Enter the 6-digit reset code from your email."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Password must be at least 8 characters."),
    ).toBeInTheDocument();
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("requires both password fields when they are empty", async () => {
    const user = userEvent.setup();
    writePersistedAuthPendingFlow({
      flow: "forgot-password-reset",
      username: "person",
    });

    render(<ForgotPasswordForm />);
    await screen.findByText("Check your inbox");
    await user.type(screen.getByLabelText("Reset code"), "123456");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(screen.getByText("New password is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Please confirm your new password."),
    ).toBeInTheDocument();
  });

  it.each([
    [
      clientError(400, "INVALID_CODE", "The code has expired"),
      "The code has expired",
    ],
    [
      clientError(409, "PASSWORD_AUTH_DISABLED", "Use your social login"),
      "Use your social login",
    ],
    [
      clientError(429, "RATE_LIMITED", "Slow down", {
        retryAfterSeconds: 42,
      }),
      "A reset code was sent recently. Try again in 42 seconds.",
    ],
  ])("maps reset failure %#", async (error, expectedMessage) => {
    const user = userEvent.setup();
    writePersistedAuthPendingFlow({
      flow: "forgot-password-reset",
      username: "person",
    });
    resetPasswordMock.mockRejectedValue(error);

    render(<ForgotPasswordForm />);
    await screen.findByText("Check your inbox");
    await user.type(screen.getByLabelText("Reset code"), "123456");
    await user.type(screen.getByLabelText("New password"), "password123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
  });

  it("resends after a fresh captcha is completed", async () => {
    const user = userEvent.setup();
    writePersistedAuthPendingFlow({
      flow: "forgot-password-reset",
      username: "person",
    });
    resendForgotPasswordMock.mockResolvedValue({ accepted: true });

    render(<ForgotPasswordForm />);
    await screen.findByText("Check your inbox");
    await user.click(screen.getByRole("button", { name: "Complete captcha" }));
    await user.click(screen.getByRole("button", { name: "Resend reset code" }));

    await waitFor(() =>
      expect(resendForgotPasswordMock).toHaveBeenCalledWith({
        username: "person",
        captchaToken: "captcha-token",
      }),
    );
    expect(
      screen.getByText(
        "If that username is eligible, a new reset code is on the way.",
      ),
    ).toBeInTheDocument();
  });

  it("clears captcha after a captcha-specific resend failure", async () => {
    const user = userEvent.setup();
    writePersistedAuthPendingFlow({
      flow: "forgot-password-reset",
      username: "person",
    });
    resendForgotPasswordMock.mockRejectedValue(
      clientError(400, "CAPTCHA_REQUIRED"),
    );

    render(<ForgotPasswordForm />);
    await screen.findByText("Check your inbox");
    await user.click(screen.getByRole("button", { name: "Complete captcha" }));
    await user.click(screen.getByRole("button", { name: "Resend reset code" }));

    expect(
      await screen.findByText("Complete the verification to continue."),
    ).toBeInTheDocument();
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
  });

  it("restores reset mode from persisted state after remount", async () => {
    writePersistedAuthPendingFlow({
      flow: "forgot-password-reset",
      username: "person",
    });

    render(<ForgotPasswordForm />);

    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
  });
});
