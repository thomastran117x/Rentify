import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginMfaPanel } from "./login-mfa-panel";
import type { LoginMfaPendingFlow } from "@/lib/auth/pending-flow";
import { ApiClientError } from "@/lib/auth/types";

const auth = vi.hoisted(() => ({
  completeLoginMfa: vi.fn(),
  getLoginPasskeyOptions: vi.fn(),
}));
const webauthn = vi.hoisted(() => ({
  supportsPasskeys: vi.fn(() => true),
  getPasskeyAssertion: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({ authApi: auth }));
vi.mock("@/lib/auth/webauthn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/webauthn")>()),
  supportsPasskeys: webauthn.supportsPasskeys,
  getPasskeyAssertion: webauthn.getPasskeyAssertion,
}));

const flow: LoginMfaPendingFlow = {
  flow: "login-mfa",
  mfaChallengeToken: "challenge-token",
  availableFactors: ["passkey", "totp"],
  factor: "passkey",
  method: "password",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const OPTIONS = { challenge: "passkey-challenge" };
const CREDENTIAL = { id: "assertion" };

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

describe("LoginMfaPanel with a passkey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webauthn.supportsPasskeys.mockReturnValue(true);
    auth.getLoginPasskeyOptions.mockResolvedValue({ options: OPTIONS });
    webauthn.getPasskeyAssertion.mockResolvedValue({
      status: "completed",
      credential: CREDENTIAL,
    });
  });

  it("signs in with the browser's assertion", async () => {
    const user = userEvent.setup();
    const session = { accessToken: "access-token" };
    auth.completeLoginMfa.mockResolvedValue(session);
    const props = renderPanel();

    expect(screen.queryByLabelText("Passkey")).toBeNull();
    await user.click(screen.getByRole("button", { name: /use passkey/i }));

    await waitFor(() => expect(props.onSuccess).toHaveBeenCalledWith(session));
    expect(auth.getLoginPasskeyOptions).toHaveBeenCalledWith({
      mfaChallengeToken: "challenge-token",
    });
    expect(webauthn.getPasskeyAssertion).toHaveBeenCalledWith(OPTIONS);
    expect(auth.completeLoginMfa).toHaveBeenCalledWith({
      mfaChallengeToken: "challenge-token",
      factor: "passkey",
      credential: CREDENTIAL,
    });
  });

  it("disables the button while the browser prompt is open", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    webauthn.getPasskeyAssertion.mockReturnValue(
      new Promise((next) => {
        finish = next;
      }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: /use passkey/i }));

    expect(
      screen.getByRole("button", { name: /waiting for your passkey/i }),
    ).toBeDisabled();
    finish({ status: "cancelled" });
    expect(
      await screen.findByRole("button", { name: /use passkey/i }),
    ).toBeEnabled();
  });

  it("asks again when the prompt was closed", async () => {
    const user = userEvent.setup();
    webauthn.getPasskeyAssertion.mockResolvedValue({ status: "cancelled" });
    const props = renderPanel();

    await user.click(screen.getByRole("button", { name: /use passkey/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /passkey prompt closed before it finished/i,
    );
    expect(auth.completeLoginMfa).not.toHaveBeenCalled();
    expect(props.onFailure).not.toHaveBeenCalled();
  });

  it("keeps the step open when the passkey is refused", async () => {
    const user = userEvent.setup();
    auth.completeLoginMfa.mockRejectedValue(
      clientError(
        400,
        "INVALID_MFA_CODE",
        "That passkey could not be verified.",
      ),
    );
    const props = renderPanel();

    await user.click(screen.getByRole("button", { name: /use passkey/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /that passkey couldn't be verified/i,
    );
    expect(props.onFailure).not.toHaveBeenCalled();
  });

  it("hands an expired sign-in back to the form", async () => {
    const user = userEvent.setup();
    const error = clientError(401, "MFA_CHALLENGE_INVALID");
    auth.getLoginPasskeyOptions.mockRejectedValue(error);
    const props = renderPanel();

    await user.click(screen.getByRole("button", { name: /use passkey/i }));

    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith(error));
  });

  it("explains a browser that could not run the prompt", async () => {
    const user = userEvent.setup();
    const { PasskeyCeremonyError } = await import("@/lib/auth/webauthn");
    webauthn.getPasskeyAssertion.mockRejectedValue(
      new PasskeyCeremonyError("Passkeys can't be used from this address."),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: /use passkey/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Passkeys can't be used from this address.",
    );
  });

  it("reports a failure it cannot explain", async () => {
    const user = userEvent.setup();
    auth.completeLoginMfa.mockRejectedValue(new Error("network"));
    renderPanel();

    await user.click(screen.getByRole("button", { name: /use passkey/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("offers the other methods, and a passkey from the code step", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ factor: "totp" });

    await user.click(screen.getByRole("button", { name: "Use a passkey" }));

    expect(props.onFactorChange).toHaveBeenCalledWith("passkey");
  });

  it("says when this browser cannot use a passkey", () => {
    webauthn.supportsPasskeys.mockReturnValue(false);
    renderPanel();

    expect(screen.getByRole("status")).toHaveTextContent(
      /this browser can't use passkeys. use a different method below/i,
    );
    expect(screen.queryByRole("button", { name: /use passkey/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Use your authenticator app" }),
    ).toBeInTheDocument();
  });

  it("hides the passkey from the other methods on such a browser", () => {
    webauthn.supportsPasskeys.mockReturnValue(false);
    renderPanel({ factor: "totp" });

    expect(screen.queryByRole("button", { name: "Use a passkey" })).toBeNull();
  });

  it("has nothing else to offer a passkey-only account on such a browser", () => {
    webauthn.supportsPasskeys.mockReturnValue(false);
    renderPanel({ availableFactors: ["passkey"] });

    expect(screen.getByRole("status")).toHaveTextContent(
      /sign in from a browser that supports them/i,
    );
  });
});
