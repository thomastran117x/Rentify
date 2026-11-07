import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryCodesPrompt } from "./recovery-codes-prompt";

const { regenerateMock } = vi.hoisted(() => ({
  regenerateMock: vi.fn(),
}));

vi.mock("@/lib/auth/mfa-recovery-codes-api", () => ({
  mfaRecoveryCodesApi: { regenerate: regenerateMock },
}));

describe("RecoveryCodesPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains what is at stake before anything happens", () => {
    render(<RecoveryCodesPrompt onDone={vi.fn()} />);

    expect(
      screen.getByText("That was your last recovery code"),
    ).toBeInTheDocument();
    expect(regenerateMock).not.toHaveBeenCalled();
  });

  it("generates codes, then finishes once they are saved", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    regenerateMock.mockResolvedValue({
      codes: ["ABCDE-FGH23"],
      remaining: 10,
      createdAt: "2026-11-07T12:00:00.000Z",
    });
    render(<RecoveryCodesPrompt onDone={onDone} />);

    await user.click(
      screen.getByRole("button", { name: "Generate new codes" }),
    );

    expect(await screen.findByText("ABCDE-FGH23")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "I've saved these codes" }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stays put with an error when generating fails, so it can be retried", async () => {
    const user = userEvent.setup();
    regenerateMock.mockRejectedValueOnce(new Error("offline"));
    regenerateMock.mockResolvedValueOnce({
      codes: ["ABCDE-FGH23"],
      remaining: 10,
      createdAt: "2026-11-07T12:00:00.000Z",
    });
    render(<RecoveryCodesPrompt onDone={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: "Generate new codes" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't generate new recovery codes/i,
    );

    await user.click(
      screen.getByRole("button", { name: "Generate new codes" }),
    );
    expect(await screen.findByText("ABCDE-FGH23")).toBeInTheDocument();
  });

  it("can be skipped", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<RecoveryCodesPrompt onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(regenerateMock).not.toHaveBeenCalled();
  });
});
