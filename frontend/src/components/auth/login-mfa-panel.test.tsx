import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginMfaPanel } from "./login-mfa-panel";
import type { LoginMfaPendingFlow } from "@/lib/auth/pending-flow";
import { ApiClientError } from "@/lib/auth/types";

const { completeLoginMfaMock } = vi.hoisted(() => ({
  completeLoginMfaMock: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: { completeLoginMfa: completeLoginMfaMock },
}));

const flow: LoginMfaPendingFlow = {
  flow: "login-mfa",
  mfaChallengeToken: "challenge-token",
  availableFactors: ["totp"],
  factor: "totp",
  method: "password",
  expiresAt: "2099-01-01T00:00:00.000Z",
  nextPath: "/dashboard",
};

function clientError(status: number, code: string, message = "Failed") {
  return new ApiClientError(message, {
    code,
    status,
    request: {
      method: "POST",
      path: "/auth/login/mfa",
      requestUrl: "http://localhost:8040/api/v1/auth/login/mfa",
    },
  });
}

function renderPanel(overrides: Partial<LoginMfaPendingFlow> = {}) {
  const props = {
    onSuccess: vi.fn(),
    onFailure: vi.fn(),
    onFactorChange: vi.fn(),
    onCancel: vi.fn(),
  };
  render(<LoginMfaPanel flow={{ ...flow, ...overrides }} {...props} />);
  return props;
}

describe("LoginMfaPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables the form while the code is being checked", async () => {
    const user = userEvent.setup();
    let resolve: (value: unknown) => void = () => undefined;
    completeLoginMfaMock.mockReturnValue(
      new Promise((next) => {
        resolve = next;
      }),
    );
    const props = renderPanel();

    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );

    expect(screen.getByRole("button", { name: "Verifying..." })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Back to sign in" }),
    ).toBeDisabled();

    resolve({ accessToken: "access" });
    await waitFor(() =>
      expect(props.onSuccess).toHaveBeenCalledWith({ accessToken: "access" }),
    );
  });

  it("shows a validation message from the api on the field", async () => {
    const user = userEvent.setup();
    completeLoginMfaMock.mockRejectedValue(
      clientError(400, "VALIDATION_ERROR", "Code is required."),
    );
    const props = renderPanel();

    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );

    expect(await screen.findByText("Code is required.")).toBeInTheDocument();
    expect(props.onFailure).not.toHaveBeenCalled();
  });

  it.each([
    [401, "MFA_CHALLENGE_INVALID"],
    [403, "ACCOUNT_SUSPENDED"],
    [423, "ACCOUNT_LOCKED"],
  ])("hands a %i %s back to the form", async (status, code) => {
    const user = userEvent.setup();
    const error = clientError(status, code);
    completeLoginMfaMock.mockRejectedValue(error);
    const props = renderPanel();

    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );

    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith(error));
  });

  it("keeps the step open for a concurrent attempt", async () => {
    const user = userEvent.setup();
    completeLoginMfaMock.mockRejectedValue(
      clientError(409, "CONFLICT", "This sign-in is already being verified."),
    );
    const props = renderPanel();

    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(props.onFailure).not.toHaveBeenCalled();
  });
});
