import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginUnlockPanel } from "./login-unlock-panel";
import { ApiClientError } from "@/lib/auth/types";

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
  AuthCaptchaPanel: ({ token, error, onChange, onReset }: { token: string; error?: string; onChange: (token: string) => void; onReset: () => void }) => (
    <div>
      <div>Captcha token: {token || "empty"}</div>
      {error ? <p>{error}</p> : null}
      <button type="button" onClick={() => onChange("fresh-token")}>Complete captcha</button>
      <button type="button" onClick={onReset}>Reset captcha</button>
    </div>
  ),
}));

function clientError(status: number, code: string, message = "Request failed", details?: unknown) {
  return new ApiClientError(message, {
    status,
    code,
    details,
    request: { method: "POST", path: "/auth/unlock", requestUrl: "/auth/unlock" },
  });
}

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

    await user.click(
      screen.getByRole("button", { name: "Resend unlock code" }),
    );

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

  it.each([
    [clientError(400, "INVALID_CODE", "Code expired"), "Code expired"],
    [clientError(429, "RATE_LIMITED", "Slow down", { retryAfterSeconds: 20 }), "A new unlock code was sent recently. Try again in 20 seconds."],
    [clientError(429, "RATE_LIMITED", "Please wait"), "Please wait"],
    [new Error("offline"), "We couldn't unlock sign-in right now. Please try again."],
  ])("maps unlock failure %#", async (error, expected) => {
    const user = userEvent.setup();
    unlockLocalLoginMock.mockRejectedValue(error);
    render(<LoginUnlockPanel email="person@example.com" onUnlocked={vi.fn()} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText("Unlock code"), "12a3456");
    await user.click(screen.getByRole("button", { name: "Unlock sign-in" }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it("requires captcha before resending and calls cancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    useAuthCaptchaTokenMock.mockReturnValue(["", vi.fn(), clearCaptchaTokenMock]);
    render(<LoginUnlockPanel email="person@example.com" onUnlocked={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Resend unlock code" }));
    expect(screen.getByText("Complete the verification to continue.")).toBeInTheDocument();
    expect(resendUnlockLocalLoginMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it.each([
    [clientError(400, "CAPTCHA_REQUIRED"), "Please complete the security check before requesting another unlock code.", "Complete the verification to continue."],
    [clientError(400, "CAPTCHA_EXPIRED"), "The security check expired or failed. Please try again.", "Please complete the verification again."],
    [clientError(400, "BAD_EMAIL", "Invalid email"), "Invalid email", null],
    [clientError(429, "RATE_LIMITED", "Slow down", { retryAfterSeconds: 10 }), "A new unlock code was sent recently. Try again in 10 seconds.", null],
    [new Error("offline"), "We couldn't resend the unlock code right now. Please try again.", null],
  ])("maps resend failure %#", async (error, general, field) => {
    const user = userEvent.setup();
    resendUnlockLocalLoginMock.mockRejectedValue(error);
    render(<LoginUnlockPanel email="person@example.com" onUnlocked={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Resend unlock code" }));
    expect(await screen.findByText(general)).toBeInTheDocument();
    if (field) expect(screen.getByText(field)).toBeInTheDocument();
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
  });

  it("clears captcha field errors through both captcha callbacks", async () => {
    const user = userEvent.setup();
    resendUnlockLocalLoginMock.mockRejectedValue(clientError(400, "CAPTCHA_INVALID"));
    render(<LoginUnlockPanel email="person@example.com" onUnlocked={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Resend unlock code" }));
    expect(await screen.findByText("Please complete the verification again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Complete captcha" }));
    expect(screen.queryByText("Please complete the verification again.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset captcha" }));
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
  });
});
