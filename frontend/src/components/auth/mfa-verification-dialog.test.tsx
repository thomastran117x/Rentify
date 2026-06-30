import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MfaVerificationDialog } from "./mfa-verification-dialog";
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

    await user.click(
      screen.getByRole("button", { name: /authenticator/i }),
    );
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

    await user.click(
      screen.getByRole("button", { name: /authenticator/i }),
    );
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
});
