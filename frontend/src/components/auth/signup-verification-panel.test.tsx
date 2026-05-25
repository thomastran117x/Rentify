import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupVerificationPanel } from "./signup-verification-panel";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  useAuthCaptchaTokenMock,
  verifyEmailMock,
  resendVerificationEmailMock,
  clearCaptchaTokenMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useAuthCaptchaTokenMock: vi.fn(),
  verifyEmailMock: vi.fn(),
  resendVerificationEmailMock: vi.fn(),
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
    verifyEmail: verifyEmailMock,
    resendVerificationEmail: resendVerificationEmailMock,
  },
}));

vi.mock("@/components/auth/auth-captcha-panel", () => ({
  AuthCaptchaPanel: ({
    token,
    error,
  }: {
    token: string;
    error?: string;
  }) => (
    <div>
      <div>Captcha token: {token || "empty"}</div>
      {error ? <p>{error}</p> : null}
    </div>
  ),
}));

describe("SignupVerificationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    useAuthMock.mockReturnValue({
      setSession: vi.fn(),
    });
    useAuthCaptchaTokenMock.mockReturnValue([
      "captcha-token",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);
  });

  it("shows validation for an invalid verification code", async () => {
    const user = userEvent.setup();

    render(
      <SignupVerificationPanel
        result={{
          verificationRequired: true,
          email: "person@example.com",
          alreadyPending: false,
        }}
      />,
    );

    await user.type(screen.getByLabelText("Verification code"), "123");
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    expect(
      screen.getByText("Enter the 6-digit verification code from your email."),
    ).toBeInTheDocument();
    expect(verifyEmailMock).not.toHaveBeenCalled();
  });

  it("verifies the email, stores the session, and redirects", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn();
    useAuthMock.mockReturnValue({ setSession });
    verifyEmailMock.mockResolvedValue({
      accessToken: "access-token",
      device: { known: true, knownByIp: false },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user",
      },
    });

    render(
      <SignupVerificationPanel
        result={{
          verificationRequired: true,
          email: "person@example.com",
          alreadyPending: false,
        }}
      />,
    );

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => {
      expect(verifyEmailMock).toHaveBeenCalledWith({
        email: "person@example.com",
        code: "123456",
      });
    });
    expect(setSession).toHaveBeenCalled();
    expect(routerReplaceMock).toHaveBeenCalledWith("/");
  });

  it("resends the verification code and clears captcha state", async () => {
    const user = userEvent.setup();
    resendVerificationEmailMock.mockResolvedValue({ accepted: true });

    render(
      <SignupVerificationPanel
        result={{
          verificationRequired: true,
          email: "person@example.com",
          alreadyPending: false,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Resend code" }));

    expect(resendVerificationEmailMock).toHaveBeenCalledWith({
      email: "person@example.com",
      captchaToken: "captcha-token",
    });
    expect(
      await screen.findByText(
        "If this email needs verification, a new code is on the way.",
      ),
    ).toBeInTheDocument();
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
  });
});
