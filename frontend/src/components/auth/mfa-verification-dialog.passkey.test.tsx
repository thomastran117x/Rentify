import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import type { MfaVerificationFactor } from "@/lib/auth/mfa-verification-api";
import {
  MfaVerificationDialog,
  offeredFactors,
  selectInitialFactor,
} from "./mfa-verification-dialog";

const api = vi.hoisted(() => ({
  issueChallenge: vi.fn(),
  confirmChallenge: vi.fn(),
  confirmPasskey: vi.fn(),
  getOptions: vi.fn(),
}));
const webauthn = vi.hoisted(() => ({
  supportsPasskeys: vi.fn(() => true),
  getPasskeyAssertion: vi.fn(),
}));

vi.mock("@/lib/auth/mfa-verification-api", () => ({
  mfaVerificationApi: api,
}));
vi.mock("@/lib/auth/webauthn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/webauthn")>()),
  supportsPasskeys: webauthn.supportsPasskeys,
  getPasskeyAssertion: webauthn.getPasskeyAssertion,
}));

const OPTIONS = {
  scope: "mfa-management" as const,
  verified: false,
  verifiedUntil: null,
  availableFactors: [
    "passkey",
    "totp",
    "recovery_code",
  ] as MfaVerificationFactor[],
  recommendedFactor: "passkey" as const,
};
const REQUEST_OPTIONS = { challenge: "passkey-challenge" };
const CREDENTIAL = { id: "assertion" };
const REQUEST = {
  method: "POST",
  path: "/auth/mfa/verify/confirm",
  requestUrl: "http://localhost:8040/api/v1/auth/mfa/verify/confirm",
};

function renderDialog(
  options = OPTIONS,
  onVerified = vi.fn(),
): { onVerified: ReturnType<typeof vi.fn> } {
  render(
    <MfaVerificationDialog
      open
      initialOptions={options}
      scope="mfa-management"
      onCancel={vi.fn()}
      onVerified={onVerified}
    />,
  );
  return { onVerified };
}

describe("MfaVerificationDialog with a passkey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webauthn.supportsPasskeys.mockReturnValue(true);
    api.issueChallenge.mockResolvedValue({
      scope: "mfa-management",
      factor: "passkey",
      challengeId: null,
      options: REQUEST_OPTIONS,
    });
    api.getOptions.mockResolvedValue(OPTIONS);
  });

  it("starts on the passkey and verifies with the browser's assertion", async () => {
    const user = userEvent.setup();
    const result = {
      verified: true,
      scope: "mfa-management",
      factor: "passkey",
      verifiedUntil: "2026-11-10T10:00:00.000Z",
    };
    webauthn.getPasskeyAssertion.mockResolvedValue({
      status: "completed",
      credential: CREDENTIAL,
    });
    api.confirmPasskey.mockResolvedValue(result);
    const { onVerified } = renderDialog();

    expect(
      screen.queryByLabelText("Verification code"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use passkey" }));

    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(result));
    expect(api.issueChallenge).toHaveBeenCalledWith(
      "mfa-management",
      "passkey",
    );
    expect(webauthn.getPasskeyAssertion).toHaveBeenCalledWith(REQUEST_OPTIONS);
    expect(api.confirmPasskey).toHaveBeenCalledWith(
      "mfa-management",
      CREDENTIAL,
    );
    expect(api.confirmChallenge).not.toHaveBeenCalled();
  });

  it("says so, and stays open, when the prompt is closed", async () => {
    const user = userEvent.setup();
    webauthn.getPasskeyAssertion.mockResolvedValue({ status: "cancelled" });
    const { onVerified } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Use passkey" }));

    expect(
      await screen.findByText(/passkey prompt closed before it finished/i),
    ).toBeInTheDocument();
    expect(api.confirmPasskey).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use passkey" })).toBeEnabled();
  });

  it("shows the server's answer to a refused assertion", async () => {
    const user = userEvent.setup();
    webauthn.getPasskeyAssertion.mockResolvedValue({
      status: "completed",
      credential: CREDENTIAL,
    });
    api.confirmPasskey.mockRejectedValue(
      new ApiClientError("That passkey could not be verified.", {
        status: 400,
        code: "INVALID_MFA_CODE",
        request: REQUEST,
      }),
    );
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Use passkey" }));

    expect(
      await screen.findByText("That passkey could not be verified."),
    ).toBeInTheDocument();
  });

  it("explains a browser that could not run the prompt", async () => {
    const user = userEvent.setup();
    const { PasskeyCeremonyError } = await import("@/lib/auth/webauthn");
    webauthn.getPasskeyAssertion.mockRejectedValue(
      new PasskeyCeremonyError("Passkeys can't be used from this address."),
    );
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Use passkey" }));

    expect(
      await screen.findByText("Passkeys can't be used from this address."),
    ).toBeInTheDocument();
  });

  it("refreshes the options when the passkey is no longer available", async () => {
    const user = userEvent.setup();
    api.issueChallenge.mockRejectedValue(
      new ApiClientError(
        "That verification method is not currently available.",
        {
          status: 400,
          code: "MFA_FACTOR_UNAVAILABLE",
          request: REQUEST,
        },
      ),
    );
    api.getOptions.mockResolvedValue({
      ...OPTIONS,
      availableFactors: ["email"],
      recommendedFactor: "email",
    });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Use passkey" }));

    expect(
      await screen.findByRole("button", { name: /send code via email/i }),
    ).toBeInTheDocument();
  });

  it("lets the user switch to the authenticator instead", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: /authenticator/i }));

    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
  });

  it("leaves the passkey out on a browser that cannot use one", () => {
    webauthn.supportsPasskeys.mockReturnValue(false);
    renderDialog();

    expect(screen.queryByRole("button", { name: /passkey/i })).toBeNull();
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
    expect(offeredFactors(OPTIONS)).toEqual(["totp", "recovery_code"]);
    expect(selectInitialFactor(OPTIONS)).toBe("totp");
  });

  it("explains a passkey-only account on a browser that cannot use one", () => {
    webauthn.supportsPasskeys.mockReturnValue(false);
    renderDialog({ ...OPTIONS, availableFactors: ["passkey"] });

    expect(
      screen.getByText(/this browser can't use passkeys/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use passkey" })).toBeNull();
  });
});
