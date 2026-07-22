import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "./signup-form";
import { writePersistedAuthPendingFlow } from "@/lib/auth/pending-flow";
import { ApiClientError, ApiServerError } from "@/lib/auth/types";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  useAuthCaptchaTokenMock,
  signupMock,
  clearCaptchaTokenMock,
  oauthSuccessSessionMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useAuthCaptchaTokenMock: vi.fn(),
  signupMock: vi.fn(),
  clearCaptchaTokenMock: vi.fn(),
  oauthSuccessSessionMock: vi.fn(),
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

  it("opens the welcome modal and defers redirect for a first-time OAuth user", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn().mockImplementation(() => {
      useAuthMock.mockReturnValue({
        status: "authenticated",
        setSession,
      });
    });
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession,
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

    render(<SignupForm nextPath="/dashboard" />);

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

    render(<SignupForm nextPath="/dashboard" />);

    await user.click(
      screen.getByRole("button", { name: "Trigger OAuth success" }),
    );

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/dashboard");
    });
    expect(screen.queryByText(/Welcome modal for/)).not.toBeInTheDocument();
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
    expect(screen.getByText("Username is required.")).toBeInTheDocument();
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
    await user.type(screen.getByLabelText("Username"), " Person ");
    await user.type(screen.getByLabelText("Email"), " Person@Example.com ");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(signupMock).toHaveBeenCalledWith({
        firstName: "Jane",
        lastName: "Doe",
        username: "person",
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
  });

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
    await user.type(screen.getByLabelText("Username"), "person");
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
  it("restores a persisted verification flow after remount", async () => {
    writePersistedAuthPendingFlow({
      flow: "signup-verification",
      email: "person@example.com",
      nextPath: "/dashboard",
      alreadyPending: true,
    });

    render(<SignupForm />);

    expect(
      await screen.findByText(
        "Verification pending for person@example.com and redirecting to /dashboard",
      ),
    ).toBeInTheDocument();
  });

  it("maps username conflicts to the username field", async () => {
    const user = userEvent.setup();
    signupMock.mockRejectedValue(
      new ApiClientError("That username is already taken.", {
        code: "CONFLICT",
        request: {
          method: "POST",
          path: "/auth/local/signup",
          requestUrl: "http://localhost:8040/api/v1/auth/local/signup",
        },
        status: 409,
        details: {
          field: "username",
        },
      }),
    );

    render(<SignupForm />);

    await user.type(screen.getByLabelText("First name"), "Jane");
    await user.type(screen.getByLabelText("Last name"), "Doe");
    await user.type(screen.getByLabelText("Username"), "person");
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findAllByText("That username is already taken."),
    ).toHaveLength(2);
  });

  it("maps captcha failures and server failures to user-facing messages", async () => {
    const user = userEvent.setup();
    signupMock.mockRejectedValueOnce(
      new ApiClientError("Captcha verification failed.", {
        code: "CAPTCHA_INVALID",
        request: {
          method: "POST",
          path: "/auth/local/signup",
          requestUrl: "http://localhost:8040/api/v1/auth/local/signup",
        },
        status: 400,
      }),
    );
    signupMock.mockRejectedValueOnce(
      new ApiServerError("Internal server error.", {
        code: "INTERNAL_ERROR",
        request: {
          method: "POST",
          path: "/auth/local/signup",
          requestUrl: "http://localhost:8040/api/v1/auth/local/signup",
        },
        status: 500,
      }),
    );

    render(<SignupForm />);

    await user.type(screen.getByLabelText("First name"), "Jane");
    await user.type(screen.getByLabelText("Last name"), "Doe");
    await user.type(screen.getByLabelText("Username"), "person");
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
        "Rentify is having trouble right now, so we couldn't create your account. Please try again in a moment.",
      ),
    ).toBeInTheDocument();
  });
});
