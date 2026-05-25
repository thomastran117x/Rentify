import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";
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
  AuthCaptchaPanel: ({ token, error }: { token: string; error?: string }) => (
    <div>
      <div>Captcha token: {token || "empty"}</div>
      {error ? <p>{error}</p> : null}
    </div>
  ),
}));

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

    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Complete the captcha before continuing."),
    ).toBeInTheDocument();
    expect(forgotPasswordMock).not.toHaveBeenCalled();
  });

  it("moves to reset mode after requesting a reset code", async () => {
    const user = userEvent.setup();
    forgotPasswordMock.mockResolvedValue({ accepted: true });

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), " Person@Example.com ");
    await user.click(screen.getByRole("button", { name: "Send reset code" }));

    await screen.findByText("Check your inbox");
    expect(forgotPasswordMock).toHaveBeenCalledWith({
      email: "person@example.com",
      captchaToken: "captcha-token",
    });
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
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

    await user.type(screen.getByLabelText("Email"), "person@example.com");
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
        email: "person@example.com",
        code: "123456",
        newPassword: "password123",
      });
    });
    expect(setSession).toHaveBeenCalled();
    expect(routerReplaceMock).toHaveBeenCalledWith("/");
  });

  it("resends a reset code after reset mode is active", async () => {
    const user = userEvent.setup();
    forgotPasswordMock.mockResolvedValue({ accepted: true });
    resendForgotPasswordMock.mockResolvedValue({ accepted: true });

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset code" }));
    await screen.findByText("Check your inbox");

    await user.click(screen.getByRole("button", { name: "Resend reset code" }));

    expect(resendForgotPasswordMock).toHaveBeenCalledWith({
      email: "person@example.com",
      captchaToken: "captcha-token",
    });
    expect(
      await screen.findByText(
        "If person@example.com is eligible, a new reset code is on the way.",
      ),
    ).toBeInTheDocument();
  });
});
