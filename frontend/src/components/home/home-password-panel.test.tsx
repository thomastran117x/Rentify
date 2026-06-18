import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/auth/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomePasswordPanel } from "./home-password-panel";

const { useAuthMock, changePasswordMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  changePasswordMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    changePassword: changePasswordMock,
  },
}));

describe("HomePasswordPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
    });
  });

  it("hides itself for non-authenticated visitors", () => {
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession: vi.fn(),
    });

    const { container } = render(<HomePasswordPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows validation errors for invalid input", async () => {
    const user = userEvent.setup();

    render(<HomePasswordPanel />);

    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      screen.getByText("Current password is required."),
    ).toBeInTheDocument();
    expect(screen.getByText("New password is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Please confirm your new password."),
    ).toBeInTheDocument();
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("updates the password, stores the session, and shows success feedback", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession,
    });
    changePasswordMock.mockResolvedValue({
      accessToken: "access-token",
      device: { known: true, knownByIp: false },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user",
      },
    });

    render(<HomePasswordPanel />);

    await user.type(screen.getByLabelText("Current password"), "current-pass");
    await user.type(screen.getByLabelText("New password"), "password123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(changePasswordMock).toHaveBeenCalledWith({
        currentPassword: "current-pass",
        newPassword: "password123",
      });
    });
    expect(setSession).toHaveBeenCalled();
    expect(
      screen.getByText("Password updated. Other sessions were signed out."),
    ).toBeInTheDocument();
  });

  it("maps incorrect current passwords to the field error", async () => {
    const user = userEvent.setup();
    changePasswordMock.mockRejectedValue(
      new ApiClientError("Unauthorized", {
        code: "UNAUTHORIZED",
        request: {
          method: "POST",
          path: "/auth/local/password/change",
          requestUrl: "http://localhost:8040/api/v1/auth/local/password/change",
        },
        status: 401,
      }),
    );

    render(<HomePasswordPanel />);

    await user.type(screen.getByLabelText("Current password"), "wrong-pass");
    await user.type(screen.getByLabelText("New password"), "password123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByText("Current password is incorrect."),
    ).toBeInTheDocument();
  });

  it("preserves the vetted conflict message for password reuse", async () => {
    const user = userEvent.setup();
    changePasswordMock.mockRejectedValue(
      new ApiClientError(
        "New password must be different from the current password.",
        {
          code: "CONFLICT",
          request: {
            method: "POST",
            path: "/auth/local/password/change",
            requestUrl:
              "http://localhost:8040/api/v1/auth/local/password/change",
          },
          status: 409,
        },
      ),
    );

    render(<HomePasswordPanel />);

    await user.type(screen.getByLabelText("Current password"), "current-pass");
    await user.type(screen.getByLabelText("New password"), "current-pass");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "current-pass",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByText(
        "New password must be different from the current password.",
      ),
    ).toBeInTheDocument();
  });
});
