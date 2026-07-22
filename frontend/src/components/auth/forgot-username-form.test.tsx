import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotUsernameForm } from "./forgot-username-form";
import { ApiClientError } from "@/lib/auth/types";

const { useAuthCaptchaTokenMock, forgotUsernameMock, clearCaptchaTokenMock } =
  vi.hoisted(() => ({
    useAuthCaptchaTokenMock: vi.fn(),
    forgotUsernameMock: vi.fn(),
    clearCaptchaTokenMock: vi.fn(),
  }));

vi.mock("@/lib/auth/captcha-store", () => ({
  useAuthCaptchaToken: useAuthCaptchaTokenMock,
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    forgotUsername: forgotUsernameMock,
  },
}));

vi.mock("@/components/auth/auth-captcha-panel", () => ({
  AuthCaptchaPanel: ({ token, error }: { token: string; error?: string }) => (
    <div>
      <div>Captcha token: {token || "empty"}</div>
      {error ? <p>{error}</p> : null}
    </div>
  ),
}));

describe("ForgotUsernameForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthCaptchaTokenMock.mockReturnValue([
      "captcha-token",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);
  });

  it("requires a valid email before submitting", async () => {
    const user = userEvent.setup();
    render(<ForgotUsernameForm />);

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(
      screen.getByRole("button", { name: "Email me my username" }),
    );

    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(forgotUsernameMock).not.toHaveBeenCalled();
  });

  it("requires a captcha token before submitting", async () => {
    const user = userEvent.setup();
    useAuthCaptchaTokenMock.mockReturnValue([
      "",
      vi.fn(),
      clearCaptchaTokenMock,
    ]);
    render(<ForgotUsernameForm />);

    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.click(
      screen.getByRole("button", { name: "Email me my username" }),
    );

    expect(
      screen.getByText("Complete the captcha before continuing."),
    ).toBeInTheDocument();
    expect(forgotUsernameMock).not.toHaveBeenCalled();
  });

  it("submits a normalized email and shows the confirmation panel", async () => {
    const user = userEvent.setup();
    forgotUsernameMock.mockResolvedValue({ accepted: true });
    render(<ForgotUsernameForm />);

    await user.type(screen.getByLabelText("Email"), " Owner@Example.com ");
    await user.click(
      screen.getByRole("button", { name: "Email me my username" }),
    );

    await waitFor(() => {
      expect(forgotUsernameMock).toHaveBeenCalledWith({
        email: "owner@example.com",
        captchaToken: "captcha-token",
      });
    });
    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
  });

  it("shows the same confirmation panel regardless of account existence", async () => {
    const user = userEvent.setup();
    // The backend always returns accepted:true for anti-enumeration.
    forgotUsernameMock.mockResolvedValue({ accepted: true });
    render(<ForgotUsernameForm />);

    await user.type(screen.getByLabelText("Email"), "missing@example.com");
    await user.click(
      screen.getByRole("button", { name: "Email me my username" }),
    );

    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
  });

  it("surfaces a captcha failure from the server", async () => {
    const user = userEvent.setup();
    forgotUsernameMock.mockRejectedValue(
      new ApiClientError("Captcha verification failed.", {
        code: "CAPTCHA_INVALID",
        request: {
          method: "POST",
          path: "/auth/local/username/forgot",
          requestUrl: "http://localhost:8040/api/v1/auth/local/username/forgot",
        },
        status: 400,
      }),
    );
    render(<ForgotUsernameForm />);

    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.click(
      screen.getByRole("button", { name: "Email me my username" }),
    );

    expect(
      await screen.findByText(
        "The security check expired or failed. Please try again.",
      ),
    ).toBeInTheDocument();
    expect(clearCaptchaTokenMock).toHaveBeenCalled();
  });
});
