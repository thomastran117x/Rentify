import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountEmailPanel,
  getEmailChangeErrorMessage,
} from "./account-email-panel";
import { ApiClientError, ApiRateLimitError } from "@/lib/api/types";

const {
  useAuthMock,
  setSessionMock,
  requestMock,
  resendMock,
  confirmMock,
  pendingMock,
  cancelMock,
  getOptionsMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  setSessionMock: vi.fn(),
  requestMock: vi.fn(),
  resendMock: vi.fn(),
  confirmMock: vi.fn(),
  pendingMock: vi.fn(),
  cancelMock: vi.fn(),
  getOptionsMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("@/components/auth/mfa-verification-dialog", () => ({
  MfaVerificationDialog: ({
    onVerified,
    onCancel,
  }: {
    onVerified: () => void;
    onCancel: () => void;
  }) => (
    <div>
      <button type="button" onClick={onVerified}>
        Approve verification
      </button>
      <button type="button" onClick={onCancel}>
        Cancel verification
      </button>
    </div>
  ),
}));
vi.mock("@/lib/auth/email-change-api", () => ({
  emailChangeApi: {
    request: requestMock,
    resend: resendMock,
    confirm: confirmMock,
    pending: pendingMock,
    cancel: cancelMock,
  },
}));
vi.mock("@/lib/auth/mfa-verification-api", () => ({
  mfaVerificationApi: { getOptions: getOptionsMock },
}));

const CURRENT_EMAIL = "owner1@rentify.local";
const NEW_EMAIL = "owner-one-new@rentify.local";

function requestContext(path: string, method = "POST") {
  return {
    method,
    path,
    requestUrl: `http://localhost:8040/api/v1${path}`,
    mode: "authenticated" as const,
  };
}

function sessionFor(email: string) {
  return {
    accessToken: "access-token-1",
    user: {
      id: "user-1",
      email,
      username: "owner-one",
      role: "owner" as const,
    },
  };
}

function acceptedResult() {
  return {
    newEmail: "o***@rentify.local",
    expiresInSeconds: 600,
    resendAvailableInSeconds: 60,
  };
}

async function openEditor() {
  await userEvent.click(screen.getByRole("button", { name: "Change email" }));
}

async function submitNewEmail(email = NEW_EMAIL) {
  await userEvent.type(screen.getByLabelText("New email address"), email);
  await userEvent.click(
    screen.getByRole("button", { name: "Send verification code" }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({
    status: "authenticated",
    session: sessionFor(CURRENT_EMAIL),
    setSession: setSessionMock,
  });
  pendingMock.mockResolvedValue({ pending: false });
  requestMock.mockResolvedValue(acceptedResult());
  resendMock.mockResolvedValue(acceptedResult());
  cancelMock.mockResolvedValue(undefined);
});

describe("AccountEmailPanel request step", () => {
  it("shows the current address and starts idle", async () => {
    render(<AccountEmailPanel />);

    expect(screen.getByText(CURRENT_EMAIL)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change email" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(pendingMock).toHaveBeenCalled());
  });

  it("sends the normalised address and moves to the code step", async () => {
    render(<AccountEmailPanel />);
    await openEditor();
    await submitNewEmail("Owner-One-New@Rentify.local");

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(NEW_EMAIL));
    expect(
      await screen.findByRole("button", { name: "Confirm new email" }),
    ).toBeInTheDocument();
  });

  it("refuses the address the account already holds without calling the API", async () => {
    render(<AccountEmailPanel />);
    await openEditor();
    await submitNewEmail(CURRENT_EMAIL);

    expect(
      await screen.findByText(
        "That is already the email address on this account.",
      ),
    ).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed address before sending", async () => {
    render(<AccountEmailPanel />);
    await openEditor();
    await submitNewEmail("not-an-address");

    await waitFor(() => expect(requestMock).not.toHaveBeenCalled());
  });

  it("shows a taken address on the field, not in the banner", async () => {
    // There is no live availability check, so the request is the first place
    // a taken address is reported.
    requestMock.mockRejectedValueOnce(
      new ApiClientError("That email address is not available.", {
        status: 409,
        code: "EMAIL_CHANGE_ADDRESS_UNAVAILABLE",
        request: requestContext("/auth/email/change"),
      }),
    );
    render(<AccountEmailPanel />);
    await openEditor();
    await submitNewEmail("taken@example.com");

    const field = await screen.findByLabelText("New email address");
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(field).toHaveAttribute(
      "aria-describedby",
      "account-new-email-error",
    );
    expect(
      screen.getByText("That email address is not available."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send verification code" }),
    ).toBeEnabled();
  });
});

describe("AccountEmailPanel step-up handling", () => {
  function rejectOnceWithMfaRequired() {
    requestMock.mockRejectedValueOnce(
      new ApiClientError("Recent MFA verification is required.", {
        status: 401,
        code: "MFA_VERIFICATION_REQUIRED",
        details: {
          scope: "mfa-management",
          availableFactors: ["email"],
          recommendedFactor: "email",
          verifiedUntil: null,
        },
        request: requestContext("/auth/email/change"),
      }),
    );
  }

  it("re-prompts and retries once the lapsed proof is renewed", async () => {
    rejectOnceWithMfaRequired();
    render(<AccountEmailPanel />);
    await openEditor();
    await submitNewEmail();

    await userEvent.click(
      await screen.findByRole("button", { name: "Approve verification" }),
    );

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", { name: "Confirm new email" }),
    ).toBeInTheDocument();
  });

  it("does not retry when the user dismisses the dialog", async () => {
    rejectOnceWithMfaRequired();
    render(<AccountEmailPanel />);
    await openEditor();
    await submitNewEmail();

    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel verification" }),
    );

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "Confirm new email" }),
    ).not.toBeInTheDocument();
  });
});

describe("AccountEmailPanel confirm step", () => {
  async function reachConfirmStep() {
    render(<AccountEmailPanel />);
    await openEditor();
    await submitNewEmail();
    return screen.findByLabelText(`Verification code sent to ${NEW_EMAIL}`);
  }

  it("adopts the returned session so every address readout updates", async () => {
    confirmMock.mockResolvedValue(sessionFor(NEW_EMAIL));
    const field = await reachConfirmStep();

    await userEvent.type(field, "123456");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm new email" }),
    );

    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith("123456"));
    expect(setSessionMock).toHaveBeenCalledWith(sessionFor(NEW_EMAIL));
    expect(
      await screen.findByText(
        `Your email is now ${NEW_EMAIL}. Other sessions were signed out.`,
      ),
    ).toBeInTheDocument();
  });

  it("keeps non-numeric characters out of the code field", async () => {
    const field = await reachConfirmStep();

    await userEvent.type(field, "12ab34");

    expect(field).toHaveValue("1234");
  });

  it("reports remaining attempts on a wrong code", async () => {
    confirmMock.mockRejectedValue(
      new ApiClientError("Verification code is invalid.", {
        status: 400,
        code: "BAD_REQUEST",
        details: { attemptsRemaining: 3 },
        request: requestContext("/auth/email/change/confirm"),
      }),
    );
    const field = await reachConfirmStep();

    await userEvent.type(field, "000000");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm new email" }),
    );

    expect(
      await screen.findByText("That code is not right. 3 attempts left."),
    ).toBeInTheDocument();
  });

  it("drops back to the address form when the pending record has expired", async () => {
    confirmMock.mockRejectedValue(
      new ApiClientError(
        "No email change is in progress. Start a new request.",
        {
          status: 409,
          code: "EMAIL_CHANGE_NOT_PENDING",
          request: requestContext("/auth/email/change/confirm"),
        },
      ),
    );
    const field = await reachConfirmStep();

    await userEvent.type(field, "123456");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm new email" }),
    );

    expect(
      await screen.findByRole("button", { name: "Change email" }),
    ).toBeInTheDocument();
  });

  it("cancels the pending change and returns to idle", async () => {
    await reachConfirmStep();

    await userEvent.click(
      screen.getByRole("button", { name: "Cancel change" }),
    );

    await waitFor(() => expect(cancelMock).toHaveBeenCalled());
    expect(
      await screen.findByRole("button", { name: "Change email" }),
    ).toBeInTheDocument();
  });

  it("counts down before a resend is allowed again", async () => {
    await reachConfirmStep();

    expect(
      screen.getByRole("button", { name: /Resend in \d+s/ }),
    ).toBeDisabled();
  });
});

describe("AccountEmailPanel rehydration", () => {
  it("restores the confirmation step from the server's pending record", async () => {
    pendingMock.mockResolvedValue({
      pending: true,
      newEmail: "o***@rentify.local",
      expiresInSeconds: 420,
    });

    render(<AccountEmailPanel />);

    expect(
      await screen.findByRole("button", { name: "Confirm new email" }),
    ).toBeInTheDocument();
  });

  it("renders nothing for a signed-out visitor", () => {
    useAuthMock.mockReturnValue({
      status: "anonymous",
      session: null,
      setSession: setSessionMock,
    });

    const { container } = render(<AccountEmailPanel />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("getEmailChangeErrorMessage", () => {
  it("surfaces the retry window from a rate limit", () => {
    const message = getEmailChangeErrorMessage(
      new ApiRateLimitError("A verification code was sent recently.", {
        status: 429,
        code: "TOO_MANY_REQUESTS",
        details: { retryAfterSeconds: 42 },
        request: requestContext("/auth/email/change/resend"),
      }),
      "change your email",
    );

    expect(message).toBe("A code was sent recently. Try again in 42 seconds.");
  });

  it("passes conflict copy through verbatim", () => {
    const message = getEmailChangeErrorMessage(
      new ApiClientError("That email address is not available.", {
        status: 409,
        code: "EMAIL_CHANGE_ADDRESS_UNAVAILABLE",
        request: requestContext("/auth/email/change"),
      }),
      "change your email",
    );

    expect(message).toBe("That email address is not available.");
  });

  it("singularises the last remaining attempt", () => {
    const message = getEmailChangeErrorMessage(
      new ApiClientError("Verification code is invalid.", {
        status: 400,
        code: "BAD_REQUEST",
        details: { attemptsRemaining: 1 },
        request: requestContext("/auth/email/change/confirm"),
      }),
      "confirm your new email",
    );

    expect(message).toBe("That code is not right. 1 attempt left.");
  });

  it("tells the user to start over once attempts run out", () => {
    const message = getEmailChangeErrorMessage(
      new ApiClientError("Verification code is invalid.", {
        status: 400,
        code: "BAD_REQUEST",
        details: { attemptsRemaining: 0 },
        request: requestContext("/auth/email/change/confirm"),
      }),
      "confirm your new email",
    );

    expect(message).toContain("run out of attempts");
  });
});
