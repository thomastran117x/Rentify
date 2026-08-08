import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupVerificationPanel } from "./signup-verification-panel";
import { ApiClientError } from "@/lib/auth/types";
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
    onChange,
    onReset,
  }: {
    token: string;
    error?: string;
    onChange: (token: string) => void;
    onReset: () => void;
  }) => (
    <div>
      <div>Captcha token: {token || "empty"}</div>
      {error ? <p>{error}</p> : null}
      <button type="button" onClick={() => onChange("new-token")}>
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
      path: "/auth/verify-email",
      requestUrl: "/api/auth/verify-email",
    },
  });
}

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

  it("redirects to the provided next path after verification", async () => {
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
        nextPath="/organizations/invitations/token-123"
      />,
    );

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith(
        "/organizations/invitations/token-123",
      );
    });
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

  it.each([
    [clientError(400, "INVALID_CODE", "Code expired"), "Code expired"],
    [
      clientError(409, "ALREADY_VERIFIED", "Already verified"),
      "Already verified",
    ],
    [
      clientError(429, "RATE_LIMITED", "Slow down", {
        retryAfterSeconds: 30,
      }),
      "A verification code was sent recently. Try again in 30 seconds.",
    ],
    [new Error("offline"), "We couldn't verify your email right now. Please try again."],
  ])("maps verification failure %#", async (error, expectedMessage) => {
    const user = userEvent.setup();
    verifyEmailMock.mockRejectedValue(error);

    render(
      <SignupVerificationPanel
        result={{
          verificationRequired: true,
          email: "person@example.com",
          alreadyPending: true,
        }}
      />,
    );
    await user.type(screen.getByLabelText("Verification code"), "12a3456");
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
  });

  it("requires captcha before resending", async () => {
    const user = userEvent.setup();
    useAuthCaptchaTokenMock.mockReturnValue(["", vi.fn(), clearCaptchaTokenMock]);

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

    expect(
      screen.getByText("Complete the verification to continue."),
    ).toBeInTheDocument();
    expect(resendVerificationEmailMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      clientError(400, "CAPTCHA_MISSING"),
      "Please complete the security check before requesting another code.",
      "Complete the verification to continue.",
    ],
    [
      clientError(400, "TURNSTILE_VALIDATION_FAILED"),
      "The security check expired or failed. Please try again.",
      "Please complete the verification again.",
    ],
    [
      clientError(400, "INVALID_EMAIL", "Email cannot be verified"),
      "Email cannot be verified",
      null,
    ],
    [
      clientError(429, "RATE_LIMITED", "Slow down", {
        retryAfterSeconds: 15,
      }),
      "A verification code was sent recently. Try again in 15 seconds.",
      null,
    ],
  ])(
    "maps resend failure %#",
    async (error, expectedGeneral, expectedField) => {
      const user = userEvent.setup();
      resendVerificationEmailMock.mockRejectedValue(error);

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

      expect(await screen.findByText(expectedGeneral)).toBeInTheDocument();
      if (expectedField) {
        expect(screen.getByText(expectedField)).toBeInTheDocument();
      }
      expect(clearCaptchaTokenMock).toHaveBeenCalled();
    },
  );

  it("clears captcha errors through captcha callbacks", async () => {
    const user = userEvent.setup();
    resendVerificationEmailMock.mockRejectedValue(
      clientError(400, "CAPTCHA_INVALID"),
    );

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
    expect(
      await screen.findByText("Please complete the verification again."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Complete captcha" }));
    expect(
      screen.queryByText("Please complete the verification again."),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset captcha" }));
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
  });
});
