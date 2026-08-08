import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isChallengeFactor,
  MfaVerificationDialog,
  normalizeCode,
  selectInitialFactor,
} from "./mfa-verification-dialog";
import type { MfaVerificationFactor } from "@/lib/auth/mfa-verification-api";

const { issueChallengeMock, confirmChallengeMock, getOptionsMock } = vi.hoisted(
  () => ({
    issueChallengeMock: vi.fn(),
    confirmChallengeMock: vi.fn(),
    getOptionsMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/mfa-verification-api", () => ({
  mfaVerificationApi: {
    issueChallenge: issueChallengeMock,
    confirmChallenge: confirmChallengeMock,
    getOptions: getOptionsMock,
  },
}));

describe("MfaVerificationDialog", () => {
  const baseOptions = {
    scope: "mfa-management" as const,
    verified: false,
    verifiedUntil: null,
    availableFactors: ["email", "totp"] as MfaVerificationFactor[],
    recommendedFactor: "email" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getOptionsMock.mockResolvedValue(baseOptions);
  });

  it("sends an email challenge and verifies the submitted code", async () => {
    const user = userEvent.setup();
    issueChallengeMock.mockResolvedValue({
      scope: "mfa-management",
      factor: "email",
      challengeId: null,
      cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    confirmChallengeMock.mockResolvedValue({
      verified: true,
      scope: "mfa-management",
      factor: "email",
      verifiedUntil: "2026-06-27T15:45:00.000Z",
    });
    const onVerified = vi.fn();

    render(
      <MfaVerificationDialog
        open
        initialOptions={baseOptions}
        scope="mfa-management"
        onCancel={vi.fn()}
        onVerified={onVerified}
      />,
    );

    await user.click(screen.getByRole("button", { name: /send code/i }));
    await user.type(screen.getByPlaceholderText("000000"), "123456");
    await user.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() => {
      expect(issueChallengeMock).toHaveBeenCalledWith(
        "mfa-management",
        "email",
      );
      expect(confirmChallengeMock).toHaveBeenCalledWith(
        "mfa-management",
        "email",
        "123456",
      );
      expect(onVerified).toHaveBeenCalledWith(
        expect.objectContaining({ verified: true, factor: "email" }),
      );
    });
  });

  it("supports switching to totp and completing verification there", async () => {
    const user = userEvent.setup();
    confirmChallengeMock.mockResolvedValue({
      verified: true,
      scope: "mfa-management",
      factor: "totp",
      verifiedUntil: "2026-06-27T15:45:00.000Z",
    });
    const onVerified = vi.fn();

    render(
      <MfaVerificationDialog
        open
        initialOptions={baseOptions}
        preferredFactor="totp"
        scope="mfa-management"
        onCancel={vi.fn()}
        onVerified={onVerified}
      />,
    );

    await user.click(screen.getByRole("button", { name: /authenticator/i }));
    await user.type(screen.getByPlaceholderText("000000"), "654321");
    await user.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() => {
      expect(confirmChallengeMock).toHaveBeenCalledWith(
        "mfa-management",
        "totp",
        "654321",
      );
      expect(onVerified).toHaveBeenCalled();
    });
  });

  it("refreshes factor options when the chosen factor becomes unavailable", async () => {
    const user = userEvent.setup();
    confirmChallengeMock.mockRejectedValue(
      new ApiClientError(
        "That verification method is not currently available.",
        {
          code: "MFA_FACTOR_UNAVAILABLE",
          request: {
            method: "POST",
            path: "/auth/mfa/verify/confirm",
            requestUrl: "http://localhost:3040/auth/mfa/verify/confirm",
          },
          status: 400,
        },
      ),
    );
    getOptionsMock.mockResolvedValue({
      ...baseOptions,
      availableFactors: ["email"],
      recommendedFactor: "email",
    });

    render(
      <MfaVerificationDialog
        open
        initialOptions={baseOptions}
        preferredFactor="totp"
        scope="mfa-management"
        onCancel={vi.fn()}
        onVerified={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /authenticator/i }));
    await user.type(screen.getByPlaceholderText("000000"), "654321");
    await user.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() => {
      expect(getOptionsMock).toHaveBeenCalledWith("mfa-management");
    });
    expect(
      screen.queryByRole("button", { name: /authenticator/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the non-recoverable no-factor state", () => {
    render(
      <MfaVerificationDialog
        open
        initialOptions={{
          ...baseOptions,
          availableFactors: [],
          recommendedFactor: null,
        }}
        scope="mfa-management"
        onCancel={vi.fn()}
        onVerified={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/No verification methods are available/i),
    ).toBeInTheDocument();
  });

  it("normalizes pasted codes, validates length, and supports SMS", async () => {
    const user = userEvent.setup();
    const smsOptions = {
      ...baseOptions,
      availableFactors: ["sms"] as MfaVerificationFactor[],
      recommendedFactor: "sms" as const,
    };
    issueChallengeMock.mockResolvedValue({
      scope: "mfa-management",
      factor: "sms",
      challengeId: null,
      cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    confirmChallengeMock.mockResolvedValue({
      verified: true,
      scope: "mfa-management",
      factor: "sms",
      verifiedUntil: "2026-08-08T12:00:00.000Z",
    });
    render(
      <MfaVerificationDialog
        open
        initialOptions={smsOptions}
        scope="mfa-management"
        onCancel={vi.fn()}
        onVerified={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /send code/i }));
    const input = screen.getByPlaceholderText("000000");
    await user.type(input, "12");
    expect(screen.getByRole("button", { name: /^verify$/i })).toBeDisabled();
    await user.clear(input);
    await user.paste("ab12-34 56xyz");
    expect(input).toHaveValue("123456");
    await user.click(screen.getByRole("button", { name: /^verify$/i }));
    await waitFor(() =>
      expect(confirmChallengeMock).toHaveBeenCalledWith(
        "mfa-management",
        "sms",
        "123456",
      ),
    );
  });

  it("cancels with Escape and renders nothing while closed", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = render(
      <MfaVerificationDialog
        open
        initialOptions={baseOptions}
        scope="mfa-management"
        onCancel={onCancel}
        onVerified={vi.fn()}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
    rerender(
      <MfaVerificationDialog
        open={false}
        initialOptions={baseOptions}
        scope="mfa-management"
        onCancel={onCancel}
        onVerified={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("selects preferred, recommended, fallback, and unavailable factors", () => {
    expect(normalizeCode("a12-345678")).toBe("123456");
    expect(isChallengeFactor("sms")).toBe(true);
    expect(isChallengeFactor("recovery-code" as never)).toBe(false);
    expect(isChallengeFactor(null)).toBe(false);

    expect(selectInitialFactor(baseOptions, "totp")).toBe("totp");
    expect(selectInitialFactor(baseOptions, "sms")).toBe("email");
    expect(
      selectInitialFactor(
        { ...baseOptions, recommendedFactor: null },
        "recovery-code" as never,
      ),
    ).toBe("email");
    expect(
      selectInitialFactor({
        ...baseOptions,
        availableFactors: ["recovery-code" as never],
        recommendedFactor: "recovery-code" as never,
      }),
    ).toBeNull();
  });

  it("reports code-entry state for an initially issued challenge", async () => {
    const onCodeEntryStateChange = vi.fn();
    const { rerender } = render(
      <MfaVerificationDialog
        open
        initialChallengeSent
        initialOptions={{
          ...baseOptions,
          availableFactors: ["email"],
        }}
        scope="mfa-management"
        onCancel={vi.fn()}
        onCodeEntryStateChange={onCodeEntryStateChange}
        onVerified={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(onCodeEntryStateChange).toHaveBeenLastCalledWith({
        challengeSent: true,
        selectedFactor: "email",
      }),
    );

    rerender(
      <MfaVerificationDialog
        open={false}
        initialChallengeSent
        initialOptions={baseOptions}
        scope="mfa-management"
        onCancel={vi.fn()}
        onCodeEntryStateChange={onCodeEntryStateChange}
        onVerified={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(onCodeEntryStateChange).toHaveBeenLastCalledWith(null),
    );
  });

  it("refreshes options when issuing an unavailable factor fails", async () => {
    const user = userEvent.setup();
    issueChallengeMock.mockRejectedValue(
      new ApiClientError("Email verification is unavailable.", {
        code: "MFA_FACTOR_UNAVAILABLE",
        request: {
          method: "POST",
          path: "/auth/mfa/verify/challenge",
          requestUrl: "http://localhost/auth/mfa/verify/challenge",
        },
        status: 400,
      }),
    );
    getOptionsMock.mockResolvedValue({
      ...baseOptions,
      availableFactors: ["totp"],
      recommendedFactor: "totp",
    });

    render(
      <MfaVerificationDialog
        open
        initialOptions={{ ...baseOptions, availableFactors: ["email"] }}
        scope="mfa-management"
        onCancel={vi.fn()}
        onVerified={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /send code/i }));

    await waitFor(() => expect(getOptionsMock).toHaveBeenCalled());
    expect(screen.getByText(/authenticator app/i)).toBeInTheDocument();
    expect(
      screen.getByText("Email verification is unavailable."),
    ).toBeInTheDocument();
  });

  it("shows fallback errors for challenge and confirmation failures", async () => {
    const user = userEvent.setup();
    issueChallengeMock.mockRejectedValueOnce(new Error("network down"));
    const { rerender } = render(
      <MfaVerificationDialog
        open
        initialOptions={{ ...baseOptions, availableFactors: ["email"] }}
        scope="mfa-management"
        onCancel={vi.fn()}
        onVerified={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /send code/i }));
    expect(
      await screen.findByText(/couldn't complete MFA verification/i),
    ).toBeInTheDocument();

    confirmChallengeMock.mockRejectedValueOnce(new Error("network down"));
    rerender(
      <MfaVerificationDialog
        open
        initialOptions={{
          ...baseOptions,
          availableFactors: ["totp"],
          recommendedFactor: "totp",
        }}
        scope="mfa-management"
        onCancel={vi.fn()}
        onVerified={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("000000");
    await user.type(input, "123456");
    await user.click(screen.getByRole("button", { name: /^verify$/i }));
    expect(
      await screen.findByText(/couldn't complete MFA verification/i),
    ).toBeInTheDocument();
  });

  it("cycles focus at both ends of the dialog", () => {
    render(
      <MfaVerificationDialog
        open
        initialOptions={baseOptions}
        scope="mfa-management"
        onCancel={vi.fn()}
        onVerified={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
  });
});
