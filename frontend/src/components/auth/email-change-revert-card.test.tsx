import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, ApiNetworkError } from "@/lib/api/types";
import { EmailChangeRevertCard } from "./email-change-revert-card";

const { authState, clearSessionMock, revertWithTokenMock, refreshMock } =
  vi.hoisted(() => ({
    authState: {
      status: "anonymous" as "anonymous" | "authenticated",
      session: null as { user: { email: string } } | null,
    },
    clearSessionMock: vi.fn(),
    revertWithTokenMock: vi.fn(),
    refreshMock: vi.fn(),
  }));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: () => ({ ...authState, clearSession: clearSessionMock }),
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: { refresh: refreshMock, logout: vi.fn() },
}));

vi.mock("@/lib/auth/email-change-api", () => ({
  emailChangeApi: { revertWithToken: revertWithTokenMock },
}));

const request = {
  method: "POST",
  path: "/auth/email/change/revert",
  requestUrl: "http://localhost:8040/api/v1/auth/email/change/revert",
};

function apiError(status: number, code: string, message: string) {
  return new ApiClientError(message, { code, status, request });
}

async function confirm() {
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Put my old email back" }));
}

describe("EmailChangeRevertCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.status = "anonymous";
    authState.session = null;
    refreshMock.mockResolvedValue(null);
  });

  it("does nothing until the user confirms", () => {
    render(<EmailChangeRevertCard token="token-1" />);

    expect(
      screen.getByRole("heading", { name: "Put your old email back?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(revertWithTokenMock).not.toHaveBeenCalled();
  });

  it("explains the link is unusable without a token", () => {
    render(<EmailChangeRevertCard token={null} />);

    expect(
      screen.getByRole("heading", { name: "This link has expired" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Put my old email back" }),
    ).not.toBeInTheDocument();
  });

  it("disables the button while the request runs", async () => {
    let finish: (value: unknown) => void = () => undefined;
    revertWithTokenMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<EmailChangeRevertCard token="token-1" />);

    await confirm();

    expect(screen.getByRole("button", { name: "Restoring..." })).toBeDisabled();

    finish({ reverted: true, nextStep: "reset_password" });

    expect(
      await screen.findByRole("heading", { name: "Your old email is back" }),
    ).toBeInTheDocument();
  });

  it("sends a held account to the password reset", async () => {
    revertWithTokenMock.mockResolvedValue({
      reverted: true,
      nextStep: "reset_password",
    });
    render(<EmailChangeRevertCard token="token-1" />);

    await confirm();

    expect(revertWithTokenMock).toHaveBeenCalledWith("token-1");
    expect(
      await screen.findByRole("link", { name: "Reset your password" }),
    ).toHaveAttribute("href", "/login?recovery=account");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("sends an account with no password to sign in instead", async () => {
    revertWithTokenMock.mockResolvedValue({
      reverted: true,
      nextStep: "sign_in",
    });
    render(<EmailChangeRevertCard token="token-1" />);

    await confirm();

    expect(
      await screen.findByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/login");
    expect(
      screen.queryByRole("link", { name: "Reset your password" }),
    ).not.toBeInTheDocument();
  });

  it("re-checks a signed-in browser's session, which the revert may have ended", async () => {
    authState.status = "authenticated";
    authState.session = { user: { email: "someone@rentify.local" } };
    revertWithTokenMock.mockResolvedValue({
      reverted: true,
      nextStep: "reset_password",
    });
    render(<EmailChangeRevertCard token="token-1" />);

    await confirm();

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(
      await screen.findByRole("heading", { name: "Your old email is back" }),
    ).toBeInTheDocument();
  });

  it("does not let a failed session check hide the result", async () => {
    authState.status = "authenticated";
    refreshMock.mockRejectedValue(new Error("Refresh failed"));
    revertWithTokenMock.mockResolvedValue({
      reverted: true,
      nextStep: "sign_in",
    });
    render(<EmailChangeRevertCard token="token-1" />);

    await confirm();

    expect(
      await screen.findByRole("heading", { name: "Your old email is back" }),
    ).toBeInTheDocument();
  });

  it("explains a spent link", async () => {
    revertWithTokenMock.mockRejectedValue(
      apiError(410, "GONE", "This link has expired or was already used."),
    );
    render(<EmailChangeRevertCard token="token-1" />);

    await confirm();

    expect(
      await screen.findByRole("heading", { name: "This link has expired" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to sign in" }),
    ).toHaveAttribute("href", "/login");
  });

  it("shows why the address could not be restored, and allows a retry", async () => {
    revertWithTokenMock.mockRejectedValueOnce(
      apiError(409, "CONFLICT", "That email address is not available."),
    );
    render(<EmailChangeRevertCard token="token-1" />);

    await confirm();

    expect(
      await screen.findByText("Your email has not changed back"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Put my old email back" }),
    ).toBeEnabled();
  });

  it("offers a retry after a network failure", async () => {
    revertWithTokenMock.mockRejectedValueOnce(
      new ApiNetworkError("Network down", { code: "NETWORK_ERROR", request }),
    );
    render(<EmailChangeRevertCard token="token-1" />);

    await confirm();

    expect(
      await screen.findByText("Your email has not changed back"),
    ).toBeInTheDocument();
  });
});
