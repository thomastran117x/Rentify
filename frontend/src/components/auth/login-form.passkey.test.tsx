import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm, PASSKEY_LOGIN_FAILED_MESSAGE } from "./login-form";
import { PASSKEY_SIGN_IN_CANCELLED_MESSAGE } from "./use-passkey-sign-in";
import { ACCOUNT_SUSPENDED_MESSAGE } from "@/lib/auth/account-status-errors";
import { clearPersistedAuthPendingFlow } from "@/lib/auth/pending-flow";
import { ApiClientError } from "@/lib/auth/types";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const { useAuthMock, setSessionMock, auth, mfa, webauthn } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  setSessionMock: vi.fn(),
  auth: {
    login: vi.fn(),
    logout: vi.fn(),
    verifyDevice: vi.fn(),
    completeLoginMfa: vi.fn(),
    getPasskeyLoginOptions: vi.fn(),
    loginWithPasskey: vi.fn(),
  },
  mfa: { getOptions: vi.fn() },
  webauthn: {
    supportsPasskeys: vi.fn(() => true),
    supportsPasskeyAutofill: vi.fn(async () => false),
    getPasskeyAssertion: vi.fn(),
    cancelPasskeyCeremony: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));
vi.mock("@/components/auth/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/auth/captcha-store", () => ({
  useAuthCaptchaToken: () => ["captcha-token", vi.fn(), vi.fn()],
}));
vi.mock("@/lib/auth/api", () => ({ authApi: auth }));
vi.mock("@/lib/auth/mfa-verification-api", () => ({
  mfaVerificationApi: mfa,
}));
vi.mock("@/lib/auth/webauthn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/webauthn")>()),
  ...webauthn,
}));
vi.mock("@/components/auth/auth-captcha-panel", () => ({
  AuthCaptchaPanel: () => <div>Captcha</div>,
}));
vi.mock("@/components/auth/oauth-buttons", () => ({
  AuthOAuthButtons: () => null,
}));
vi.mock("@/components/auth/login-unlock-panel", () => ({
  LoginUnlockPanel: ({ email }: { email: string }) => (
    <div>Unlock panel for {email}</div>
  ),
}));

const OPTIONS = { challenge: "passkey-challenge", rpId: "localhost" };
const CREDENTIAL = { id: "assertion" };
const SESSION = {
  accessToken: "access-token",
  device: { known: false, knownByIp: false },
  user: {
    id: "user-1",
    email: "person@example.com",
    username: "person",
    role: "user" as const,
  },
};

function clientError(status: number, code: string, details?: unknown) {
  return new ApiClientError("Failed", {
    code,
    status,
    details,
    request: {
      method: "POST",
      path: "/auth/passkey/login/verify",
      requestUrl: "http://localhost:8040/api/v1/auth/passkey/login/verify",
    },
  });
}

function passkeyButton() {
  return screen.findByRole("button", { name: "Sign in with a passkey" });
}

describe("LoginForm passkey sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    clearPersistedAuthPendingFlow();
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession: setSessionMock,
      clearSession: vi.fn(),
    });
    webauthn.supportsPasskeys.mockReturnValue(true);
    webauthn.supportsPasskeyAutofill.mockResolvedValue(false);
    auth.getPasskeyLoginOptions.mockResolvedValue({ options: OPTIONS });
    auth.verifyDevice.mockResolvedValue(undefined);
    mfa.getOptions.mockResolvedValue({
      verified: true,
      availableFactors: ["passkey"],
    });
  });

  it("offers passkeys in the username field's autofill", () => {
    render(<LoginForm nextPath="/" />);

    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "autocomplete",
      "username webauthn",
    );
  });

  it("hides the button in a browser without WebAuthn", async () => {
    webauthn.supportsPasskeys.mockReturnValue(false);

    render(<LoginForm nextPath="/" />);

    await waitFor(() => expect(webauthn.supportsPasskeys).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "Sign in with a passkey" }),
    ).not.toBeInTheDocument();
  });

  it("signs in with the passkey alone and passes the device check on its proof", async () => {
    webauthn.getPasskeyAssertion.mockResolvedValue({
      status: "completed",
      credential: CREDENTIAL,
    });
    auth.loginWithPasskey.mockResolvedValue(SESSION);

    render(<LoginForm nextPath="/" />);
    await userEvent.click(await passkeyButton());

    await waitFor(() =>
      expect(auth.loginWithPasskey).toHaveBeenCalledWith({
        credential: CREDENTIAL,
      }),
    );
    expect(webauthn.getPasskeyAssertion).toHaveBeenCalledWith(OPTIONS);
    expect(auth.login).not.toHaveBeenCalled();
    expect(setSessionMock).toHaveBeenCalledWith(SESSION);
    await waitFor(() => expect(auth.verifyDevice).toHaveBeenCalled());
    expect(mfa.getOptions).toHaveBeenCalledWith("device-login");
  });

  it("says plainly when the passkey could not sign in", async () => {
    webauthn.getPasskeyAssertion.mockResolvedValue({
      status: "completed",
      credential: CREDENTIAL,
    });
    auth.loginWithPasskey.mockRejectedValue(
      clientError(401, "PASSKEY_LOGIN_FAILED"),
    );

    render(<LoginForm nextPath="/" />);
    await userEvent.click(await passkeyButton());

    expect(
      await screen.findByText(PASSKEY_LOGIN_FAILED_MESSAGE),
    ).toBeInTheDocument();
    expect(setSessionMock).not.toHaveBeenCalled();
    expect(await passkeyButton()).toBeEnabled();
  });

  it("shows the suspension like a password sign-in", async () => {
    webauthn.getPasskeyAssertion.mockResolvedValue({
      status: "completed",
      credential: CREDENTIAL,
    });
    auth.loginWithPasskey.mockRejectedValue(
      clientError(403, "ACCOUNT_SUSPENDED"),
    );

    render(<LoginForm nextPath="/" />);
    await userEvent.click(await passkeyButton());

    expect(
      await screen.findByText(ACCOUNT_SUSPENDED_MESSAGE),
    ).toBeInTheDocument();
  });

  it("opens the unlock step for a locked username", async () => {
    webauthn.getPasskeyAssertion.mockResolvedValue({
      status: "completed",
      credential: CREDENTIAL,
    });
    auth.loginWithPasskey.mockRejectedValue(
      clientError(423, "ACCOUNT_LOCKED", {
        email: "person@example.com",
        unlockRequired: true,
      }),
    );

    render(<LoginForm nextPath="/" />);
    await userEvent.click(await passkeyButton());

    expect(
      await screen.findByText("Unlock panel for person@example.com"),
    ).toBeInTheDocument();
  });

  it("only notes a closed prompt", async () => {
    webauthn.getPasskeyAssertion.mockResolvedValue({ status: "cancelled" });

    render(<LoginForm nextPath="/" />);
    await userEvent.click(await passkeyButton());

    expect(
      await screen.findByText(PASSKEY_SIGN_IN_CANCELLED_MESSAGE),
    ).toBeInTheDocument();
    expect(auth.loginWithPasskey).not.toHaveBeenCalled();
    expect(screen.queryByText("Couldn't sign you in")).not.toBeInTheDocument();
  });

  it("signs in from the username field's autofill", async () => {
    webauthn.supportsPasskeyAutofill.mockResolvedValue(true);
    webauthn.getPasskeyAssertion.mockResolvedValue({
      status: "completed",
      credential: CREDENTIAL,
    });
    auth.loginWithPasskey.mockResolvedValue(SESSION);

    render(<LoginForm nextPath="/" />);

    await waitFor(() =>
      expect(webauthn.getPasskeyAssertion).toHaveBeenCalledWith(OPTIONS, {
        autofill: true,
      }),
    );
    await waitFor(() =>
      expect(auth.loginWithPasskey).toHaveBeenCalledWith({
        credential: CREDENTIAL,
      }),
    );
    expect(setSessionMock).toHaveBeenCalledWith(SESSION);
  });

  it("starts autofill again with a fresh challenge after a refused sign-in", async () => {
    webauthn.supportsPasskeyAutofill.mockResolvedValue(true);
    webauthn.getPasskeyAssertion
      .mockResolvedValueOnce({ status: "completed", credential: CREDENTIAL })
      .mockReturnValue(new Promise(() => {}));
    auth.loginWithPasskey.mockRejectedValue(
      clientError(401, "PASSKEY_LOGIN_FAILED"),
    );

    render(<LoginForm nextPath="/" />);

    expect(
      await screen.findByText(PASSKEY_LOGIN_FAILED_MESSAGE),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(auth.getPasskeyLoginOptions).toHaveBeenCalledTimes(2),
    );
    expect(webauthn.getPasskeyAssertion).toHaveBeenLastCalledWith(OPTIONS, {
      autofill: true,
    });
  });

  it("stays quiet when autofill cannot start", async () => {
    webauthn.supportsPasskeyAutofill.mockResolvedValue(true);
    auth.getPasskeyLoginOptions.mockRejectedValue(new Error("offline"));

    render(<LoginForm nextPath="/" />);

    await waitFor(() => expect(auth.getPasskeyLoginOptions).toHaveBeenCalled());
    expect(screen.queryByText("Couldn't sign you in")).not.toBeInTheDocument();
  });
});
