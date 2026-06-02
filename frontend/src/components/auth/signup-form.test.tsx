import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "./signup-form";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  useAuthCaptchaTokenMock,
  signupMock,
  clearCaptchaTokenMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useAuthCaptchaTokenMock: vi.fn(),
  signupMock: vi.fn(),
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
    signup: signupMock,
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

vi.mock("@/components/auth/signup-verification-panel", () => ({
  SignupVerificationPanel: ({
    result,
    nextPath,
  }: {
    result: { email: string };
    nextPath?: string;
  }) => (
    <div>
      Verification pending for {result.email}
      {nextPath ? ` and redirecting to ${nextPath}` : ""}
    </div>
  ),
}));

describe("SignupForm", () => {
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

    render(<SignupForm />);

    expect(screen.getByText("Preparing your workspace...")).toBeInTheDocument();
  });

  it("redirects authenticated users immediately", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
    });

    render(<SignupForm />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/");
    });
  });

  it("redirects authenticated users to the provided next path", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
    });

    render(<SignupForm nextPath="/organizations/invitations/token-123" />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith(
        "/organizations/invitations/token-123",
      );
    });
  });

  it("shows validation errors for missing and invalid values", async () => {
    const user = userEvent.setup();
    useAuthCaptchaTokenMock.mockReturnValue([
      "",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);

    render(<SignupForm />);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("First name is required.")).toBeInTheDocument();
    expect(screen.getByText("Last name is required.")).toBeInTheDocument();
    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Please confirm your password."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Complete the captcha before creating your account."),
    ).toBeInTheDocument();
    expect(signupMock).not.toHaveBeenCalled();
  });

  it("submits a normalized signup request and shows verification state", async () => {
    const user = userEvent.setup();
    signupMock.mockResolvedValue({
      verificationRequired: true,
      email: "person@example.com",
      alreadyPending: false,
    });

    render(<SignupForm />);

    await user.type(screen.getByLabelText("First name"), " Jane ");
    await user.type(screen.getByLabelText("Last name"), " Doe ");
    await user.type(screen.getByLabelText("Email"), " Person@Example.com ");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(signupMock).toHaveBeenCalledWith({
        firstName: "Jane",
        lastName: "Doe",
        email: "person@example.com",
        password: "password123",
        captchaToken: "captcha-token",
      });
    });
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Verification pending for person@example.com and redirecting to /",
      ),
    ).toBeInTheDocument();
  }, 10000);

  it("passes the next path into the verification state", async () => {
    const user = userEvent.setup();
    signupMock.mockResolvedValue({
      verificationRequired: true,
      email: "person@example.com",
      alreadyPending: false,
    });

    render(<SignupForm nextPath="/organizations/invitations/token-123" />);

    await user.type(screen.getByLabelText("First name"), "Jane");
    await user.type(screen.getByLabelText("Last name"), "Doe");
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(
        "Verification pending for person@example.com and redirecting to /organizations/invitations/token-123",
      ),
    ).toBeInTheDocument();
  });

  it("maps conflict responses to the email field", async () => {
    const user = userEvent.setup();
    signupMock.mockRejectedValue({
      status: 409,
      body: {
        error: "Account already exists.",
      },
    });

    render(<SignupForm />);

    await user.type(screen.getByLabelText("First name"), "Jane");
    await user.type(screen.getByLabelText("Last name"), "Doe");
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("Account already exists."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This email is already in use."),
    ).toBeInTheDocument();
  });

  it("maps captcha failures and server failures to user-facing messages", async () => {
    const user = userEvent.setup();
    signupMock.mockRejectedValueOnce({
      status: 400,
      body: {
        code: "CAPTCHA_INVALID",
      },
    });
    signupMock.mockRejectedValueOnce({
      status: 500,
    });

    render(<SignupForm />);

    await user.type(screen.getByLabelText("First name"), "Jane");
    await user.type(screen.getByLabelText("Last name"), "Doe");
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(
        "The security check expired or failed. Please try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please complete the verification again."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(
        "Something went wrong on our side. Please try again in a moment.",
      ),
    ).toBeInTheDocument();
  });
});
