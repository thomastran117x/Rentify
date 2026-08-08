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
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getStatusMock: vi.fn(),
  beginEnrollmentMock: vi.fn(),
  confirmEnrollmentMock: vi.fn(),
  cancelEnrollmentMock: vi.fn(),
  disableMock: vi.fn(),
  getOptionsMock: vi.fn(),
  qrCodeMock: vi.fn(async () => "data:image/png;base64,test"),
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
    confirmEnrollmentMock.mockResolvedValue({ enabled: true });

    render(<HomeMfaTotpPanel />);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    expect(await screen.findByText("ABCD EFGH IJKL MNOP")).toBeInTheDocument();
    const input = screen.getByPlaceholderText("000000");
    await user.type(input, "ab12-3456");
    expect(input).toHaveValue("123456");
    await user.click(screen.getByRole("button", { name: "Verify and enable" }));

    expect(await screen.findByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText(/account is now protected/i)).toBeInTheDocument();
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
      await screen.findByText("Authenticator app disabled."),
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
