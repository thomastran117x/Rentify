import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountRecoveryDialog } from "./account-recovery-dialog";

vi.mock("./forgot-password-form", () => ({
  ForgotPasswordForm: () => <div>Forgot password form content</div>,
}));

describe("AccountRecoveryDialog", () => {
  it("shows account recovery options when opened", () => {
    render(<AccountRecoveryDialog open={true} onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "I can't log in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /I forgot my username/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /I forgot my password/i }),
    ).toBeInTheDocument();
  });

  it("shows the username placeholder and lets the user return", async () => {
    const user = userEvent.setup();

    render(<AccountRecoveryDialog open={true} onClose={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: /I forgot my username/i }),
    );

    expect(
      screen.getByText(/Forgot username is still a placeholder/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("button", { name: /I forgot my password/i }),
    ).toBeInTheDocument();
  });

  it("switches into the password recovery flow", async () => {
    const user = userEvent.setup();

    render(<AccountRecoveryDialog open={true} onClose={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: /I forgot my password/i }),
    );

    expect(
      screen.getByRole("heading", { name: "Reset password" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Forgot password form content"),
    ).toBeInTheDocument();
  });

  it("closes when the close button is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<AccountRecoveryDialog open={true} onClose={onClose} />);

    await user.click(
      screen.getByRole("button", {
        name: "Close account recovery dialog",
      }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
