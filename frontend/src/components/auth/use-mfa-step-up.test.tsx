import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import { useMfaStepUp, type StepUpOutcome } from "./use-mfa-step-up";

const { getOptionsMock, confirmChallengeMock } = vi.hoisted(() => ({
  getOptionsMock: vi.fn(),
  confirmChallengeMock: vi.fn(),
}));

vi.mock("@/lib/auth/mfa-verification-api", () => ({
  mfaVerificationApi: {
    getOptions: getOptionsMock,
    issueChallenge: vi.fn(),
    confirmChallenge: confirmChallengeMock,
  },
}));

function stepUpRequired(details?: unknown) {
  return new ApiClientError("Recent MFA verification is required.", {
    status: 401,
    code: "MFA_VERIFICATION_REQUIRED",
    details,
    request: {
      method: "POST",
      path: "/auth/personal-access-tokens",
      requestUrl: "https://api.test/api/v1/auth/personal-access-tokens",
    },
  });
}

const totpDetails = {
  scope: "mfa-management",
  availableFactors: ["totp"],
  recommendedFactor: "totp",
  verifiedUntil: null,
};

function Harness({ action }: { action: () => Promise<string> }) {
  const { runWithStepUp, stepUpDialog } = useMfaStepUp();
  const [outcome, setOutcome] = useState<StepUpOutcome<string> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          runWithStepUp(action)
            .then(setOutcome)
            .catch((error: Error) => setFailure(error.message));
        }}
      >
        Run
      </button>
      {outcome ? <p>outcome: {JSON.stringify(outcome)}</p> : null}
      {failure ? <p>failure: {failure}</p> : null}
      {stepUpDialog}
    </>
  );
}

async function completeDialog() {
  const user = userEvent.setup();
  await user.type(await screen.findByPlaceholderText("000000"), "123456");
  await user.click(screen.getByRole("button", { name: "Verify" }));
}

describe("useMfaStepUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmChallengeMock.mockResolvedValue({
      verified: true,
      scope: "mfa-management",
      factor: "totp",
      verifiedUntil: "2026-11-04T12:00:00.000Z",
    });
  });

  it("runs the action without a prompt when no step-up is needed", async () => {
    const action = vi.fn().mockResolvedValue("done");
    render(<Harness action={action} />);

    await userEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(
      await screen.findByText('outcome: {"completed":true,"result":"done"}'),
    ).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the dialog on MFA_VERIFICATION_REQUIRED and retries once verified", async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(stepUpRequired(totpDetails))
      .mockResolvedValueOnce("done");
    render(<Harness action={action} />);

    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await completeDialog();

    expect(
      await screen.findByText('outcome: {"completed":true,"result":"done"}'),
    ).toBeInTheDocument();
    expect(confirmChallengeMock).toHaveBeenCalledWith(
      "mfa-management",
      "totp",
      "123456",
    );
    expect(action).toHaveBeenCalledTimes(2);
    expect(getOptionsMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("reports a dismissed dialog without retrying", async () => {
    const action = vi.fn().mockRejectedValue(stepUpRequired(totpDetails));
    render(<Harness action={action} />);

    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );

    expect(
      await screen.findByText('outcome: {"completed":false}'),
    ).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks for the options when the error carries no factors", async () => {
    getOptionsMock.mockResolvedValue({ ...totpDetails, verified: false });
    const action = vi
      .fn()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValueOnce("done");
    render(<Harness action={action} />);

    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await completeDialog();

    expect(
      await screen.findByText('outcome: {"completed":true,"result":"done"}'),
    ).toBeInTheDocument();
    expect(getOptionsMock).toHaveBeenCalledWith("mfa-management");
  });

  it("retries straight away when the session turns out to be verified", async () => {
    getOptionsMock.mockResolvedValue({ ...totpDetails, verified: true });
    const action = vi
      .fn()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValueOnce("done");
    render(<Harness action={action} />);

    await userEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(
      await screen.findByText('outcome: {"completed":true,"result":"done"}'),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rethrows any other failure", async () => {
    const action = vi.fn().mockRejectedValue(new Error("network down"));
    render(<Harness action={action} />);

    await userEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(
      await screen.findByText("failure: network down"),
    ).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
  });
});
