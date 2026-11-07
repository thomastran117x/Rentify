import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatSecret, HomeMfaTotpPanel } from "./home-mfa-totp-panel";

const {
  useAuthMock,
  getStatusMock,
  beginEnrollmentMock,
  confirmEnrollmentMock,
  cancelEnrollmentMock,
  disableMock,
  getOptionsMock,
  qrCodeMock,
  getRecoveryStatusMock,
  regenerateMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getStatusMock: vi.fn(),
  beginEnrollmentMock: vi.fn(),
  confirmEnrollmentMock: vi.fn(),
  cancelEnrollmentMock: vi.fn(),
  disableMock: vi.fn(),
  getOptionsMock: vi.fn(),
  qrCodeMock: vi.fn(async () => "data:image/png;base64,test"),
  getRecoveryStatusMock: vi.fn(),
  regenerateMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/auth/mfa-totp-api", () => ({
  mfaTotpApi: {
    getStatus: getStatusMock,
    beginEnrollment: beginEnrollmentMock,
    confirmEnrollment: confirmEnrollmentMock,
    cancelEnrollment: cancelEnrollmentMock,
    disable: disableMock,
  },
}));

vi.mock("@/lib/auth/mfa-recovery-codes-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/auth/mfa-recovery-codes-api")
  >()),
  mfaRecoveryCodesApi: {
    getStatus: getRecoveryStatusMock,
    regenerate: regenerateMock,
  },
}));

vi.mock("@/lib/auth/mfa-verification-api", () => ({
  mfaVerificationApi: {
    getOptions: getOptionsMock,
  },
}));

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

vi.mock("qrcode", () => ({
  default: {
    toDataURL: qrCodeMock,
  },
  toDataURL: qrCodeMock,
}));

describe("HomeMfaTotpPanel", () => {
  function createVerificationRequiredError(
    availableFactors: Array<"email" | "totp"> = ["email"],
  ) {
    return new ApiClientError("Recent MFA verification is required.", {
      code: "MFA_VERIFICATION_REQUIRED",
      details: {
        scope: "mfa-management",
        availableFactors,
        recommendedFactor: availableFactors[0] ?? null,
        verifiedUntil: null,
      },
      request: {
        method: "POST",
        path: "/auth/mfa/totp/begin",
        requestUrl: "http://localhost:3040/auth/mfa/totp/begin",
      },
      status: 401,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          email: "user@example.com",
        },
      },
    });
    getStatusMock.mockResolvedValue({ enabled: false });
    getRecoveryStatusMock.mockResolvedValue({
      remaining: 10,
      createdAt: "2026-11-07T12:00:00.000Z",
    });
    getOptionsMock.mockResolvedValue({
      scope: "mfa-management",
      verified: false,
      verifiedUntil: null,
      availableFactors: ["email"],
      recommendedFactor: "email",
    });
    qrCodeMock.mockResolvedValue("data:image/png;base64,test");
  });

  it("starts enrollment after the user completes MFA verification", async () => {
    const user = userEvent.setup();
    beginEnrollmentMock
      .mockRejectedValueOnce(createVerificationRequiredError())
      .mockResolvedValueOnce({
        secret: "ABCDEF123456",
        uri: "otpauth://totp/Test",
      });

    render(<HomeMfaTotpPanel />);

    await screen.findByText("Not enabled");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    await user.click(
      screen.getByRole("button", { name: "Approve verification" }),
    );

    await waitFor(() => {
      expect(beginEnrollmentMock).toHaveBeenCalledTimes(2);
      expect(beginEnrollmentMock).toHaveBeenNthCalledWith(
        2,
        "user@example.com",
      );
    });
    expect(getOptionsMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Scan this QR code with your authenticator app/i),
    ).toBeInTheDocument();
  });

  it("shows the no-factor error instead of opening an empty dialog", async () => {
    const user = userEvent.setup();
    beginEnrollmentMock.mockRejectedValueOnce(
      createVerificationRequiredError([]),
    );

    render(<HomeMfaTotpPanel />);

    await screen.findByText("Not enabled");
    await user.click(screen.getByRole("button", { name: "Set up" }));

    expect(
      screen.getByText(/no MFA verification methods are available/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve verification" }),
    ).not.toBeInTheDocument();
    expect(getOptionsMock).not.toHaveBeenCalled();
  });

  it("re-verifies once and retries the protected action on MFA_VERIFICATION_REQUIRED", async () => {
    const user = userEvent.setup();
    beginEnrollmentMock
      .mockRejectedValueOnce(createVerificationRequiredError())
      .mockResolvedValueOnce({
        secret: "ABCDEF123456",
        uri: "otpauth://totp/Test",
      });

    render(<HomeMfaTotpPanel />);

    await screen.findByText("Not enabled");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    await user.click(
      screen.getByRole("button", { name: "Approve verification" }),
    );

    await waitFor(() => {
      expect(beginEnrollmentMock).toHaveBeenCalledTimes(2);
    });
    expect(getOptionsMock).not.toHaveBeenCalled();
  });

  it("formats secrets and hides the panel from unauthenticated users", () => {
    expect(formatSecret("ABCDEFGHIJKLMNOP")).toBe("ABCD EFGH IJKL MNOP");
    expect(formatSecret("")).toBe("");
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });
    const { container } = render(<HomeMfaTotpPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(getStatusMock).not.toHaveBeenCalled();
  });

  it("shows status-loading failures and direct enrollment failures", async () => {
    getStatusMock.mockRejectedValueOnce(new Error("offline"));
    const { rerender } = render(<HomeMfaTotpPanel />);
    expect(
      await screen.findByText(/couldn't load your MFA status/i),
    ).toBeInTheDocument();

    getStatusMock.mockResolvedValueOnce({ enabled: false });
    rerender(<HomeMfaTotpPanel />);
  });

  it("starts, confirms, and resets a direct enrollment", async () => {
    const user = userEvent.setup();
    beginEnrollmentMock.mockResolvedValue({
      secret: "ABCDEFGHIJKLMNOP",
      uri: "otpauth://totp/Test",
    });
    confirmEnrollmentMock.mockResolvedValue({
      confirmed: true,
      recoveryCodes: ["ABCDE-FGH23", "JKLMN-PQR45"],
    });

    render(<HomeMfaTotpPanel />);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    expect(await screen.findByText("ABCD EFGH IJKL MNOP")).toBeInTheDocument();
    const input = screen.getByPlaceholderText("000000");
    await user.type(input, "ab12-3456");
    expect(input).toHaveValue("123456");
    await user.click(screen.getByRole("button", { name: "Verify and enable" }));

    // The codes come first, and only once.
    expect(await screen.findByText("ABCDE-FGH23")).toBeInTheDocument();
    expect(screen.getByText(/account is now protected/i)).toBeInTheDocument();
    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "I've saved these codes" }),
    );

    expect(await screen.findByText("Enabled")).toBeInTheDocument();
    expect(screen.queryByText("ABCDE-FGH23")).not.toBeInTheDocument();
    expect(
      await screen.findByText("10 recovery codes left"),
    ).toBeInTheDocument();
  });

  describe("recovery codes", () => {
    function renderEnabled(status: {
      remaining: number;
      createdAt: string | null;
    }) {
      getStatusMock.mockResolvedValue({ enabled: true });
      getRecoveryStatusMock.mockResolvedValue(status);
      render(<HomeMfaTotpPanel />);
    }

    const createdAt = "2026-11-07T12:00:00.000Z";

    it("does not ask about them without an authenticator", async () => {
      render(<HomeMfaTotpPanel />);

      expect(await screen.findByText("Not enabled")).toBeInTheDocument();
      expect(getRecoveryStatusMock).not.toHaveBeenCalled();
    });

    it("warns at two or fewer", async () => {
      renderEnabled({ remaining: 2, createdAt });

      expect(
        await screen.findByText("Only 2 recovery codes left"),
      ).toBeInTheDocument();
    });

    it("uses the singular for the last code", async () => {
      renderEnabled({ remaining: 1, createdAt });

      expect(
        await screen.findByText("Only 1 recovery code left"),
      ).toBeInTheDocument();
    });

    it("stays calm above that", async () => {
      renderEnabled({ remaining: 3, createdAt });

      expect(
        await screen.findByText("3 recovery codes left"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("says so when every code is used", async () => {
      renderEnabled({ remaining: 0, createdAt });

      expect(
        await screen.findByText("You've used all your recovery codes"),
      ).toBeInTheDocument();
    });

    it("offers a first set to an account enrolled before they existed", async () => {
      const user = userEvent.setup();
      regenerateMock.mockResolvedValue({
        codes: ["ABCDE-FGH23"],
        remaining: 10,
        createdAt,
      });
      renderEnabled({ remaining: 0, createdAt: null });

      await user.click(
        await screen.findByRole("button", {
          name: "Generate recovery codes",
        }),
      );

      expect(await screen.findByText("ABCDE-FGH23")).toBeInTheDocument();
    });

    it("steps up, then shows the new codes and the fresh count", async () => {
      const user = userEvent.setup();
      regenerateMock
        .mockRejectedValueOnce(createVerificationRequiredError(["totp"]))
        .mockResolvedValueOnce({
          codes: ["ABCDE-FGH23"],
          remaining: 10,
          createdAt,
        });
      renderEnabled({ remaining: 1, createdAt });

      await user.click(
        await screen.findByRole("button", { name: "Generate new codes" }),
      );
      await user.click(
        await screen.findByRole("button", { name: "Approve verification" }),
      );

      expect(await screen.findByText("ABCDE-FGH23")).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "I've saved these codes" }),
      );
      expect(
        await screen.findByText("10 recovery codes left"),
      ).toBeInTheDocument();
    });

    it("reports a failed regeneration and keeps the current status", async () => {
      const user = userEvent.setup();
      regenerateMock.mockRejectedValue(new Error("offline"));
      renderEnabled({ remaining: 1, createdAt });

      await user.click(
        await screen.findByRole("button", { name: "Generate new codes" }),
      );

      expect(
        await screen.findByText(/couldn't generate new recovery codes/i),
      ).toBeInTheDocument();
      expect(screen.getByText("Only 1 recovery code left")).toBeInTheDocument();
    });

    it("leaves the authenticator usable when the status cannot be read", async () => {
      getRecoveryStatusMock.mockRejectedValue(new Error("offline"));
      getStatusMock.mockResolvedValue({ enabled: true });
      render(<HomeMfaTotpPanel />);

      expect(await screen.findByText("Enabled")).toBeInTheDocument();
      expect(screen.queryByText(/recovery code/i)).not.toBeInTheDocument();
    });

    it("forgets the status when the authenticator is turned off", async () => {
      const user = userEvent.setup();
      disableMock.mockResolvedValue({ disabled: true });
      renderEnabled({ remaining: 5, createdAt });

      expect(
        await screen.findByText("5 recovery codes left"),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Disable" }));

      expect(await screen.findByText("Not enabled")).toBeInTheDocument();
      expect(screen.queryByText(/recovery code/i)).not.toBeInTheDocument();
    });
  });

  it("cancels enrollment even when server cleanup fails", async () => {
    const user = userEvent.setup();
    beginEnrollmentMock.mockResolvedValue({
      secret: "ABCD",
      uri: "otpauth://totp/Test",
    });
    cancelEnrollmentMock.mockRejectedValue(new Error("cleanup failed"));
    render(<HomeMfaTotpPanel />);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Not enabled")).toBeInTheDocument();
    expect(cancelEnrollmentMock).toHaveBeenCalled();
  });

  it("disables an enabled authenticator and reports disable failures", async () => {
    const user = userEvent.setup();
    getStatusMock.mockResolvedValue({ enabled: true });
    disableMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ enabled: false });
    render(<HomeMfaTotpPanel />);

    await user.click(await screen.findByRole("button", { name: "Disable" }));
    expect(
      await screen.findByText(/couldn't disable your authenticator app/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disable" }));
    expect(
      await screen.findByText(
        "Authenticator app disabled. Other sessions were signed out.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Not enabled")).toBeInTheDocument();
  });

  it("uses fetched options when verification-required details are absent", async () => {
    const user = userEvent.setup();
    const error = new ApiClientError("Verification required", {
      code: "MFA_VERIFICATION_REQUIRED",
      request: {
        method: "POST",
        path: "/auth/mfa/totp/begin",
        requestUrl: "http://localhost/begin",
      },
      status: 401,
    });
    beginEnrollmentMock
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ secret: "ABCD", uri: "otpauth://totp/Test" });
    getOptionsMock.mockResolvedValue({
      scope: "mfa-management",
      verified: true,
      verifiedUntil: "2026-08-08T12:00:00.000Z",
      availableFactors: ["totp"],
      recommendedFactor: "totp",
    });
    render(<HomeMfaTotpPanel />);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    expect(await screen.findByText(/Scan this QR code/i)).toBeInTheDocument();
    expect(getOptionsMock).toHaveBeenCalledWith("mfa-management");
  });

  it("does not retry a protected action when verification is cancelled", async () => {
    const user = userEvent.setup();
    beginEnrollmentMock.mockRejectedValueOnce(
      createVerificationRequiredError(),
    );
    render(<HomeMfaTotpPanel />);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    await user.click(
      screen.getByRole("button", { name: "Cancel verification" }),
    );
    await waitFor(() => expect(beginEnrollmentMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Not enabled")).toBeInTheDocument();
  });

  it("shows enrollment and confirmation errors", async () => {
    const user = userEvent.setup();
    beginEnrollmentMock.mockRejectedValueOnce(new Error("offline"));
    render(<HomeMfaTotpPanel />);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    expect(
      await screen.findByText(/couldn't start MFA setup/i),
    ).toBeInTheDocument();

    beginEnrollmentMock.mockResolvedValueOnce({
      secret: "ABCD",
      uri: "otpauth://totp/Test",
    });
    confirmEnrollmentMock.mockRejectedValueOnce(new Error("bad code"));
    await user.click(screen.getByRole("button", { name: "Set up" }));
    await user.type(await screen.findByPlaceholderText("000000"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and enable" }));
    expect(
      await screen.findByText(/couldn't verify that code/i),
    ).toBeInTheDocument();
  });
});
