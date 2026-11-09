import {
  fireEvent,
  render as testingLibraryRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "./signup-form";
import {
  clearPersistedAuthPendingFlow,
  readPersistedAuthPendingFlow,
  writePersistedAuthPendingFlow,
} from "@/lib/auth/pending-flow";
import { ApiClientError, ApiServerError } from "@/lib/auth/types";
import {
  resetRouterMocks,
  routerPushMock,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  useAuthCaptchaTokenMock,
  signupMock,
  checkUsernameAvailabilityMock,
  getUsernameSuggestionsMock,
  clearCaptchaTokenMock,
  oauthSuccessSessionMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useAuthCaptchaTokenMock: vi.fn(),
  signupMock: vi.fn(),
  checkUsernameAvailabilityMock: vi.fn(),
  getUsernameSuggestionsMock: vi.fn(),
  clearCaptchaTokenMock: vi.fn(),
  oauthSuccessSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    push: routerPushMock,
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
    checkUsernameAvailability: checkUsernameAvailabilityMock,
    getUsernameSuggestions: getUsernameSuggestionsMock,
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
        onClick={() =>
          onMfaRequired?.({
            mfaRequired: true,
            mfaChallengeToken: "challenge-token",
            availableFactors: ["totp"],
            expiresInSeconds: 300,
          })
        }
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

const render = testingLibraryRender;

type User = ReturnType<typeof userEvent.setup>;

/**
 * Fill the "Account" step and advance to "About you".
 *
 * Signup is a two-step form, so almost every test that cares about a profile
 * field has to get past this step first.
 */
async function completeAccountStep(
  user: User,
  values: { email?: string; password?: string; confirmPassword?: string } = {},
) {
  const {
    email = "person@example.com",
    password = "StrongPassw0rd!",
    confirmPassword = password,
  } = values;

  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirmPassword);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByLabelText("First name");
}

/** Fill the "About you" step, leaving submission to the caller. */
async function fillProfileStep(
  user: User,
  values: {
    firstName?: string;
    lastName?: string;
    username?: string;
    dateOfBirth?: string;
  } = {},
) {
  const {
    firstName = "Jane",
    lastName = "Doe",
    username = "person",
    dateOfBirth = "2012-06-15",
  } = values;

  await user.type(screen.getByLabelText("First name"), firstName);
  await user.type(screen.getByLabelText("Last name"), lastName);
  await user.type(screen.getByLabelText("Username"), username);
  fireEvent.change(screen.getByLabelText("Date of birth"), {
    target: { value: dateOfBirth },
  });
}

describe("SignupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    // Default: every username is free, so tests that are not about
    // availability are unaffected by the debounced background check.
    checkUsernameAvailabilityMock.mockResolvedValue({
      username: "jane-doe",
      available: true,
      reason: null,
    });
    getUsernameSuggestionsMock.mockResolvedValue({
      suggestions: [
        "bright-otter-4827",
        "calm-willow-1034",
        "swift-comet-9261",
      ],
    });
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

  it("fills the username field from a suggestion", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);
    await completeAccountStep(user);

    await user.click(
      await screen.findByRole("button", {
        name: "Use username bright-otter-4827",
      }),
    );

    expect(screen.getByLabelText("Username")).toHaveValue("bright-otter-4827");

    // Scoped to the username hint: the email hint uses the same
    // "Checking availability..." string and stays mounted, hidden, on the
    // first step, where a queryByText would still find it.
    const hint = document.getElementById("signup-username-availability");
    expect(hint).toHaveTextContent("bright-otter-4827 is available.");
    expect(hint).not.toHaveTextContent("Checking availability...");
    expect(checkUsernameAvailabilityMock).not.toHaveBeenCalled();
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

  it("redirects to / instead of an off-site next path", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
    });

    render(<SignupForm nextPath="//example.org" />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/");
    });
    expect(routerReplaceMock).not.toHaveBeenCalledWith("//example.org");
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

  it("hands an authenticator-protected OAuth sign-in to the sign-in page", async () => {
    const user = userEvent.setup();
    clearPersistedAuthPendingFlow();

    render(<SignupForm nextPath="/dashboard" />);

    await user.click(screen.getByRole("button", { name: "Trigger OAuth MFA" }));

    expect(readPersistedAuthPendingFlow()).toMatchObject({
      flow: "login-mfa",
      mfaChallengeToken: "challenge-token",
      method: "oauth",
    });
    expect(routerPushMock).toHaveBeenCalledWith("/login?next=%2Fdashboard");
    clearPersistedAuthPendingFlow();
  });

  it("keeps an empty first step from advancing", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Please confirm your password."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
    expect(signupMock).not.toHaveBeenCalled();
  });

  it("keeps a mismatched password from advancing", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "StrongPassw0rd!");
    await user.type(screen.getByLabelText("Confirm password"), "password124");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
  });

  it("shows validation errors for the missing values on the second step", async () => {
    const user = userEvent.setup();
    useAuthCaptchaTokenMock.mockReturnValue([
      "",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);

    render(<SignupForm />);
    await completeAccountStep(user);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("First name is required.")).toBeInTheDocument();
    expect(screen.getByText("Last name is required.")).toBeInTheDocument();
    expect(screen.getByText("Username is required.")).toBeInTheDocument();
    expect(screen.getByText("Date of birth is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Complete the captcha before creating your account."),
    ).toBeInTheDocument();
    expect(signupMock).not.toHaveBeenCalled();
  });

  it("rejects a password the backend would refuse", async () => {
    // `strongPasswordSchema` needs 12+ characters; letting a shorter one
    // through would only send a guaranteed 400.
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByText("Password must be at least 12 characters."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();

    // The checklist outlives the error and points at what is still missing.
    const requirements = screen.getByRole("list", {
      name: "Password requirements",
    });
    expect(
      within(requirements).getByText("At least 12 characters").closest("li"),
    ).toHaveAttribute("data-state", "unmet");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-describedby",
      "signup-password-error signup-password-requirements",
    );
  });

  it("ticks off password requirements as the user types", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    const requirements = screen.getByRole("list", {
      name: "Password requirements",
    });
    const lengthRow = within(requirements)
      .getByText("At least 12 characters")
      .closest("li");
    expect(lengthRow).toHaveAttribute("data-state", "pending");

    await user.type(screen.getByLabelText("Password"), "tidal harbo");

    expect(lengthRow).toHaveAttribute("data-state", "pending");

    await user.type(screen.getByLabelText("Password"), "r");

    expect(lengthRow).toHaveAttribute("data-state", "met");
  });

  it("submits the account step when Enter is pressed on the first step", async () => {
    // Both steps share one form, so once the second step has been reached its
    // hidden submit button would otherwise become the default submitter and
    // Enter would run the full signup from the first step.
    const user = userEvent.setup();
    render(<SignupForm />);
    await completeAccountStep(user);
    await user.click(screen.getByRole("button", { name: "Back" }));

    await user.type(screen.getByLabelText("Email"), "{Enter}");

    expect(signupMock).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("First name")).toBeVisible();
  });

  it("keeps the first step's values when the user goes back", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);
    await completeAccountStep(user, { email: "person@example.com" });

    await user.type(screen.getByLabelText("First name"), "Jane");
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByLabelText("Email")).toHaveValue(
      "person@example.com",
    );
    expect(screen.getByLabelText("Password")).toHaveValue("StrongPassw0rd!");

    // And the second step still holds what was typed there.
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText("First name")).toHaveValue("Jane");
  });

  it("unlocks the second step in the stepper once it is reached", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    const nav = screen.getByRole("navigation", { name: "Signup steps" });
    expect(
      within(nav).getByRole("button", { name: /About you/ }),
    ).toBeDisabled();

    await completeAccountStep(user);

    expect(
      within(nav).getByRole("button", { name: /About you/ }),
    ).toHaveAttribute("aria-current", "step");
    expect(
      within(nav).getByRole("button", { name: /Account/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("submits a normalized signup request and shows verification state", async () => {
    const user = userEvent.setup();
    signupMock.mockResolvedValue({
      verificationRequired: true,
      email: "person@example.com",
      alreadyPending: false,
    });

    render(<SignupForm />);

    await completeAccountStep(user, { email: " Person@Example.com " });
    await fillProfileStep(user, {
      firstName: " Jane ",
      lastName: " Doe ",
      username: " Person ",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(signupMock).toHaveBeenCalledWith({
        firstName: "Jane",
        lastName: "Doe",
        username: "person",
        email: "person@example.com",
        password: "StrongPassw0rd!",
        dateOfBirth: "2012-06-15",
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

    await completeAccountStep(user, { email: "person@example.com" });
    await fillProfileStep(user, {
      firstName: "Jane",
      lastName: "Doe",
      username: "person",
    });
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

    await completeAccountStep(user, { email: "person@example.com" });
    await fillProfileStep(user, {
      firstName: "Jane",
      lastName: "Doe",
      username: "person",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findAllByText("That username is already taken."),
    ).toHaveLength(2);
  });

  it("returns to the first step when the server rejects the email", async () => {
    const user = userEvent.setup();
    signupMock.mockRejectedValue(
      new ApiClientError("An account with this email already exists.", {
        code: "CONFLICT",
        request: {
          method: "POST",
          path: "/auth/local/signup",
          requestUrl: "http://localhost:8040/api/v1/auth/local/signup",
        },
        status: 409,
      }),
    );

    render(<SignupForm />);
    await completeAccountStep(user, { email: "person@example.com" });
    await fillProfileStep(user);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    // The message belongs to the email field, so the step holding it reopens.
    expect(
      await screen.findByText("This email is already in use."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("person@example.com");
  });

  it("confirms an available username as the user types", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);
    await completeAccountStep(user);

    await user.type(screen.getByLabelText("Username"), "jane-doe");

    expect(
      await screen.findByText("jane-doe is available."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(checkUsernameAvailabilityMock).toHaveBeenCalledWith(
        "jane-doe",
        expect.anything(),
      ),
    );
  });

  it("blocks submission of a username the availability check reported taken", async () => {
    checkUsernameAvailabilityMock.mockResolvedValue({
      username: "taken-name",
      available: false,
      reason: "taken",
    });
    const user = userEvent.setup();
    render(<SignupForm />);

    await completeAccountStep(user, { email: "person@example.com" });
    await fillProfileStep(user, {
      firstName: "Jane",
      lastName: "Doe",
      username: "taken-name",
    });

    expect(
      await screen.findByText("That username is already taken."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Nothing to gain from a round trip that can only fail.
    expect(signupMock).not.toHaveBeenCalled();
  });

  it("shows live feedback and blocks an inappropriate username", async () => {
    checkUsernameAvailabilityMock.mockImplementation(
      async (candidate: string) =>
        candidate === "friendlyshittyperson"
          ? {
              username: candidate,
              available: false,
              reason: "inappropriate",
            }
          : { username: candidate, available: true, reason: null },
    );
    const user = userEvent.setup();
    render(<SignupForm />);

    await completeAccountStep(user, { email: "person@example.com" });
    await fillProfileStep(user, {
      firstName: "Jane",
      lastName: "Doe",
      username: "friendlyshittyperson",
    });

    expect(
      await screen.findAllByText("That username isn’t allowed."),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(signupMock).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Username"));
    await user.type(screen.getByLabelText("Username"), "friendly-person");
    expect(
      await screen.findByText("friendly-person is available."),
    ).toBeInTheDocument();
  });

  it("maps a direct username policy rejection back to the field", async () => {
    const user = userEvent.setup();
    signupMock.mockRejectedValue(
      new ApiClientError("That username isn’t allowed.", {
        code: "BAD_REQUEST",
        details: { field: "username", reason: "inappropriate" },
        request: {
          method: "POST",
          path: "/auth/local/signup",
          requestUrl: "http://localhost:8040/api/v1/auth/local/signup",
        },
        status: 400,
      }),
    );
    render(<SignupForm />);

    await completeAccountStep(user, { email: "person@example.com" });
    await fillProfileStep(user, {
      firstName: "Jane",
      lastName: "Doe",
      username: "jane-doe",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findAllByText("That username isn’t allowed."),
    ).toHaveLength(2);
  });

  it("asks nothing about the email before submitting", async () => {
    // Signup answers a new address and a registered one the same way, so a
    // live "taken" check would reveal what signup is built to hide. Whatever
    // the address, the form goes straight through to the inbox step.
    signupMock.mockResolvedValue({ verificationRequired: true });
    const user = userEvent.setup();
    render(<SignupForm />);

    await completeAccountStep(user, { email: "owner1@rentify.local" });

    expect(
      screen.queryByText("This email is already in use."),
    ).not.toBeInTheDocument();

    await fillProfileStep(user, {
      firstName: "Jane",
      lastName: "Doe",
      username: "jane-doe",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(signupMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: "owner1@rentify.local" }),
      ),
    );
  });

  it("does not check availability for a username that fails the format rule", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);
    await completeAccountStep(user);

    await user.type(screen.getByLabelText("Username"), "no");

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(checkUsernameAvailabilityMock).not.toHaveBeenCalled();
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

    await completeAccountStep(user, { email: "person@example.com" });
    await fillProfileStep(user, {
      firstName: "Jane",
      lastName: "Doe",
      username: "person",
    });
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
