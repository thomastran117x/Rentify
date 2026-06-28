import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeMfaTotpPanel } from "./home-mfa-totp-panel";

const {
  useAuthMock,
  getStatusMock,
  beginEnrollmentMock,
  confirmEnrollmentMock,
  cancelEnrollmentMock,
  disableMock,
  getOptionsMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getStatusMock: vi.fn(),
  beginEnrollmentMock: vi.fn(),
  confirmEnrollmentMock: vi.fn(),
  cancelEnrollmentMock: vi.fn(),
  disableMock: vi.fn(),
  getOptionsMock: vi.fn(),
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
  MfaVerificationDialog: ({ onVerified, onCancel }: { onVerified: () => void; onCancel: () => void }) => (
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
    toDataURL: vi.fn(async () => "data:image/png;base64,test"),
  },
  toDataURL: vi.fn(async () => "data:image/png;base64,test"),
}));

describe("HomeMfaTotpPanel", () => {
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
  });

  it("starts enrollment after the user completes MFA verification", async () => {
    const user = userEvent.setup();
    beginEnrollmentMock.mockResolvedValue({
      secret: "ABCDEF123456",
      uri: "otpauth://totp/Test",
    });

    render(<HomeMfaTotpPanel />);

    await screen.findByText("Not enabled");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    await user.click(screen.getByRole("button", { name: "Approve verification" }));

    await waitFor(() => {
      expect(beginEnrollmentMock).toHaveBeenCalledWith("user@example.com");
    });
    expect(
      screen.getByText(/Scan this QR code with your authenticator app/i),
    ).toBeInTheDocument();
  });

  it("shows the no-factor error instead of opening an empty dialog", async () => {
    const user = userEvent.setup();
    getOptionsMock.mockResolvedValue({
      scope: "mfa-management",
      verified: false,
      verifiedUntil: null,
      availableFactors: [],
      recommendedFactor: null,
    });

    render(<HomeMfaTotpPanel />);

    await screen.findByText("Not enabled");
    await user.click(screen.getByRole("button", { name: "Set up" }));

    expect(
      screen.getByText(/no MFA verification methods are available/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve verification" }),
    ).not.toBeInTheDocument();
  });

  it("re-verifies once and retries the protected action on MFA_VERIFICATION_REQUIRED", async () => {
    const user = userEvent.setup();
    beginEnrollmentMock
      .mockRejectedValueOnce(
        new ApiClientError("Recent MFA verification is required.", {
          code: "MFA_VERIFICATION_REQUIRED",
          request: {
            method: "POST",
            path: "/auth/mfa/totp/begin",
            requestUrl: "http://localhost:3040/auth/mfa/totp/begin",
          },
          status: 401,
        }),
      )
      .mockResolvedValueOnce({
        secret: "ABCDEF123456",
        uri: "otpauth://totp/Test",
      });

    render(<HomeMfaTotpPanel />);

    await screen.findByText("Not enabled");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    await user.click(screen.getByRole("button", { name: "Approve verification" }));
    await user.click(screen.getByRole("button", { name: "Approve verification" }));

    await waitFor(() => {
      expect(beginEnrollmentMock).toHaveBeenCalledTimes(2);
      expect(getOptionsMock).toHaveBeenCalledTimes(2);
    });
  });
});
