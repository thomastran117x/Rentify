import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginUnlockPanel } from "./login-unlock-panel";

const {
  useAuthCaptchaTokenMock,
  unlockLocalLoginMock,
  resendUnlockLocalLoginMock,
  clearCaptchaTokenMock,
} = vi.hoisted(() => ({
  useAuthCaptchaTokenMock: vi.fn(),
  unlockLocalLoginMock: vi.fn(),
  resendUnlockLocalLoginMock: vi.fn(),
  clearCaptchaTokenMock: vi.fn(),
}));

vi.mock("@/lib/auth/captcha-store", () => ({
  useAuthCaptchaToken: useAuthCaptchaTokenMock,
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    unlockLocalLogin: unlockLocalLoginMock,
    resendUnlockLocalLogin: resendUnlockLocalLoginMock,
  },
}));

vi.mock("@/components/auth/auth-captcha-panel", () => ({
  AuthCaptchaPanel: ({
    token,
    error,
  }: {
    token: string;
    error?: string;
  }) => (
    <div>
      <div>Captcha token: {token || "empty"}</div>
      {error ? <p>{error}</p> : null}
    </div>
  ),
}));

describe("LoginUnlockPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthCaptchaTokenMock.mockReturnValue([
      "captcha-token",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);
  });

  it("shows validation for an invalid unlock code", async () => {
    const user = userEvent.setup();

    render(
      <LoginUnlockPanel
        email="person@example.com"
        onUnlocked={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Unlock code"), "123");
    await user.click(screen.getByRole("button", { name: "Unlock sign-in" }));

    expect(
      screen.getByText("Enter the 6-digit unlock code from your email."),
    ).toBeInTheDocument();
    expect(unlockLocalLoginMock).not.toHaveBeenCalled();
  });

  it("unlocks sign-in and notifies the parent", async () => {
    const user = userEvent.setup();
    const onUnlocked = vi.fn();
    unlockLocalLoginMock.mockResolvedValue({
      unlocked: true,
      email: "person@example.com",
    });

    render(
      <LoginUnlockPanel
        email="person@example.com"
        onUnlocked={onUnlocked}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Unlock code"), "123456");
    await user.click(screen.getByRole("button", { name: "Unlock sign-in" }));

    await waitFor(() => {
      expect(unlockLocalLoginMock).toHaveBeenCalledWith({
        email: "person@example.com",
        code: "123456",
      });
    });
    expect(onUnlocked).toHaveBeenCalledWith(
      "Sign-in unlocked. Try your password again.",
    );
  });

  it("resends an unlock code and shows the success message", async () => {
    const user = userEvent.setup();
    resendUnlockLocalLoginMock.mockResolvedValue({ accepted: true });

    render(
      <LoginUnlockPanel
        email="person@example.com"
        onUnlocked={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Resend unlock code" }));

    expect(resendUnlockLocalLoginMock).toHaveBeenCalledWith({
      email: "person@example.com",
      captchaToken: "captcha-token",
    });
    expect(
      await screen.findByText(
        "If sign-in is locked for this email, a new unlock code is on the way.",
      ),
    ).toBeInTheDocument();
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
  });
});
