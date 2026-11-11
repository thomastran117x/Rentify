import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import { HomeMfaRecoveryCodesPanel } from "./home-mfa-recovery-codes-panel";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getOptions: vi.fn(),
  getStatus: vi.fn(),
  regenerate: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({ useAuth: mocks.useAuth }));
vi.mock("@/lib/auth/mfa-verification-api", () => ({
  mfaVerificationApi: { getOptions: mocks.getOptions },
}));
vi.mock("@/lib/auth/mfa-recovery-codes-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/auth/mfa-recovery-codes-api")
  >()),
  mfaRecoveryCodesApi: {
    getStatus: mocks.getStatus,
    regenerate: mocks.regenerate,
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

const CREATED_AT = "2026-11-07T12:00:00.000Z";

function options(availableFactors: string[]) {
  return {
    scope: "mfa-management",
    verified: true,
    verifiedUntil: null,
    availableFactors,
    recommendedFactor: availableFactors[0] ?? null,
  };
}

function stepUpRequired() {
  return new ApiClientError("Recent MFA verification is required.", {
    code: "MFA_VERIFICATION_REQUIRED",
    status: 401,
    details: {
      scope: "mfa-management",
      availableFactors: ["passkey"],
      recommendedFactor: "passkey",
      verifiedUntil: null,
    },
    request: {
      method: "POST",
      path: "/auth/mfa/recovery-codes/regenerate",
      requestUrl:
        "http://localhost:8040/api/v1/auth/mfa/recovery-codes/regenerate",
    },
  });
}

function renderWith(
  status: { remaining: number; createdAt: string | null },
  factors = ["passkey", "recovery_code"],
) {
  mocks.getOptions.mockResolvedValue(options(factors));
  mocks.getStatus.mockResolvedValue(status);
  return render(<HomeMfaRecoveryCodesPanel />);
}

describe("HomeMfaRecoveryCodesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({ status: "authenticated" });
  });

  it("shows for an account whose only strong factor is a passkey", async () => {
    renderWith({ remaining: 10, createdAt: CREATED_AT });

    expect(
      await screen.findByRole("heading", { name: "Recovery codes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("10 recovery codes left")).toBeInTheDocument();
  });

  it("shows for an account with an authenticator", async () => {
    renderWith({ remaining: 3, createdAt: CREATED_AT }, ["totp"]);

    expect(
      await screen.findByText("3 recovery codes left"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays hidden for an account that steps up by email", async () => {
    renderWith({ remaining: 0, createdAt: null }, ["email"]);

    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalled());
    expect(
      screen.queryByRole("heading", { name: "Recovery codes" }),
    ).toBeNull();
  });

  it("stays hidden when its status cannot be read", async () => {
    mocks.getOptions.mockResolvedValue(options(["passkey"]));
    mocks.getStatus.mockRejectedValue(new Error("offline"));
    render(<HomeMfaRecoveryCodesPanel />);

    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalled());
    expect(
      screen.queryByRole("heading", { name: "Recovery codes" }),
    ).toBeNull();
  });

  it("renders nothing for a signed-out visitor", () => {
    mocks.useAuth.mockReturnValue({ status: "unauthenticated" });
    const { container } = render(<HomeMfaRecoveryCodesPanel />);

    expect(container).toBeEmptyDOMElement();
    expect(mocks.getOptions).not.toHaveBeenCalled();
  });

  it.each([
    [2, "Only 2 recovery codes left"],
    [1, "Only 1 recovery code left"],
    [0, "You've used all your recovery codes"],
  ])("warns with %s left", async (remaining, text) => {
    renderWith({ remaining, createdAt: CREATED_AT });

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("offers a first set to an account that never had one", async () => {
    const user = userEvent.setup();
    mocks.regenerate.mockResolvedValue({
      codes: ["ABCDE-FGH23"],
      remaining: 10,
      createdAt: CREATED_AT,
    });
    renderWith({ remaining: 0, createdAt: null }, ["totp"]);

    await user.click(
      await screen.findByRole("button", { name: "Generate recovery codes" }),
    );

    expect(await screen.findByText("ABCDE-FGH23")).toBeInTheDocument();
  });

  it("steps up, then shows the new codes and the fresh count", async () => {
    const user = userEvent.setup();
    mocks.regenerate
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValueOnce({
        codes: ["ABCDE-FGH23"],
        remaining: 10,
        createdAt: CREATED_AT,
      });
    renderWith({ remaining: 1, createdAt: CREATED_AT });

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

  it("keeps the current set when the step-up is dismissed", async () => {
    const user = userEvent.setup();
    mocks.regenerate.mockRejectedValue(stepUpRequired());
    renderWith({ remaining: 1, createdAt: CREATED_AT });

    await user.click(
      await screen.findByRole("button", { name: "Generate new codes" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Cancel verification" }),
    );

    expect(
      await screen.findByText("Only 1 recovery code left"),
    ).toBeInTheDocument();
    expect(mocks.regenerate).toHaveBeenCalledTimes(1);
  });

  it("reports a failed regeneration and keeps the current status", async () => {
    const user = userEvent.setup();
    mocks.regenerate.mockRejectedValue(new Error("offline"));
    renderWith({ remaining: 1, createdAt: CREATED_AT });

    await user.click(
      await screen.findByRole("button", { name: "Generate new codes" }),
    );

    expect(
      await screen.findByText(/couldn't generate new recovery codes/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Only 1 recovery code left")).toBeInTheDocument();
  });

  it("reads the factors again when they change, and hides with the last one", async () => {
    mocks.getOptions.mockResolvedValue(options(["passkey"]));
    mocks.getStatus.mockResolvedValue({ remaining: 10, createdAt: CREATED_AT });
    const { rerender } = render(<HomeMfaRecoveryCodesPanel refreshKey={0} />);
    expect(
      await screen.findByText("10 recovery codes left"),
    ).toBeInTheDocument();

    mocks.getOptions.mockResolvedValue(options(["email"]));
    mocks.getStatus.mockResolvedValue({ remaining: 0, createdAt: null });
    rerender(<HomeMfaRecoveryCodesPanel refreshKey={1} />);

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Recovery codes" }),
      ).toBeNull(),
    );
  });
});
