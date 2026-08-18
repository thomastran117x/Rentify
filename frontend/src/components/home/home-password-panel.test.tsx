import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/auth/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomePasswordPanel } from "./home-password-panel";

const {
  useAuthMock,
  changePasswordMock,
  setPasswordMock,
  linkedOAuthProvidersMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  changePasswordMock: vi.fn(),
  setPasswordMock: vi.fn(),
  linkedOAuthProvidersMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    changePassword: changePasswordMock,
    setPassword: setPasswordMock,
    linkedOAuthProviders: linkedOAuthProvidersMock,
  },
}));

const SESSION = {
  accessToken: "access-token",
  device: { known: true, knownByIp: false },
  user: {
    id: "user-1",
    email: "person@example.com",
    username: "person",
    role: "user" as const,
  },
};

describe("HomePasswordPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: vi.fn(),
      session: SESSION,
    });
    linkedOAuthProvidersMock.mockResolvedValue({
      hasPassword: true,
      providers: [],
    });
  });

  it("hides itself for non-authenticated visitors", () => {
    useAuthMock.mockReturnValue({
      status: "anonymous",
      setSession: vi.fn(),
      session: null,
    });

    const { container } = render(<HomePasswordPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows validation errors for invalid input", async () => {
    const user = userEvent.setup();

    render(<HomePasswordPanel hasPassword />);

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

  it("rejects a weak new password before calling the API", async () => {
    const user = userEvent.setup();

    render(<HomePasswordPanel hasPassword />);

    await user.type(screen.getByLabelText("Current password"), "current-pass");
    await user.type(screen.getByLabelText("New password"), "password123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      screen.getByText(
        "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.",
      ),
    ).toBeInTheDocument();
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("rejects a password the backend's unsafe-input rule would refuse", async () => {
    const user = userEvent.setup();

    render(<HomePasswordPanel hasPassword />);

    await user.type(screen.getByLabelText("Current password"), "current-pass");
    // Passes the character-class rule -- "<" counts as a special character --
    // but the backend rejects it via containsUnsafeAuthInput.
    await user.type(screen.getByLabelText("New password"), "Valid123<tag>");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "Valid123<tag>",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      screen.getByText("Input contains unsupported HTML or script content."),
    ).toBeInTheDocument();
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("updates the password, stores the session, and shows success feedback", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession,
      session: SESSION,
    });
    changePasswordMock.mockResolvedValue(SESSION);

    render(<HomePasswordPanel hasPassword />);

    await user.type(screen.getByLabelText("Current password"), "current-pass");
    await user.type(screen.getByLabelText("New password"), "Rentify123!");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "Rentify123!",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(changePasswordMock).toHaveBeenCalledWith({
        currentPassword: "current-pass",
        newPassword: "Rentify123!",
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

    render(<HomePasswordPanel hasPassword />);

    await user.type(screen.getByLabelText("Current password"), "wrong-pass");
    await user.type(screen.getByLabelText("New password"), "Rentify123!");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "Rentify123!",
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

    render(<HomePasswordPanel hasPassword />);

    await user.type(screen.getByLabelText("Current password"), "current-pass");
    await user.type(screen.getByLabelText("New password"), "Rentify123!");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "Rentify123!",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByText(
        "New password must be different from the current password.",
      ),
    ).toBeInTheDocument();
  });

  describe("when the account has no password yet", () => {
    it("omits the current password field and calls setPassword", async () => {
      const user = userEvent.setup();
      const setSession = vi.fn();
      const onPasswordSet = vi.fn();
      useAuthMock.mockReturnValue({
        status: "authenticated",
        setSession,
        session: SESSION,
      });
      setPasswordMock.mockResolvedValue(SESSION);

      render(
        <HomePasswordPanel hasPassword={false} onPasswordSet={onPasswordSet} />,
      );

      expect(screen.queryByLabelText("Current password")).toBeNull();

      await user.type(screen.getByLabelText("New password"), "Rentify123!");
      await user.type(
        screen.getByLabelText("Confirm new password"),
        "Rentify123!",
      );
      await user.click(screen.getByRole("button", { name: "Set password" }));

      await waitFor(() => {
        expect(setPasswordMock).toHaveBeenCalledWith({
          newPassword: "Rentify123!",
        });
      });
      expect(changePasswordMock).not.toHaveBeenCalled();
      expect(setSession).toHaveBeenCalled();
      expect(onPasswordSet).toHaveBeenCalled();
      expect(
        screen.getByText(/You can now sign in with your username \(person\)/),
      ).toBeInTheDocument();
    });

    it("still requires a matching, strong password", async () => {
      const user = userEvent.setup();

      render(<HomePasswordPanel hasPassword={false} />);

      await user.type(screen.getByLabelText("New password"), "Rentify123!");
      await user.type(
        screen.getByLabelText("Confirm new password"),
        "Rentify124!",
      );
      await user.click(screen.getByRole("button", { name: "Set password" }));

      expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
      expect(setPasswordMock).not.toHaveBeenCalled();
    });

    it("surfaces the conflict when the account already has a password", async () => {
      const user = userEvent.setup();
      setPasswordMock.mockRejectedValue(
        new ApiClientError(
          "This account already has a password. Use the change password option instead.",
          {
            code: "CONFLICT",
            request: {
              method: "POST",
              path: "/auth/local/password/set",
              requestUrl:
                "http://localhost:8040/api/v1/auth/local/password/set",
            },
            status: 409,
          },
        ),
      );

      render(<HomePasswordPanel hasPassword={false} />);

      await user.type(screen.getByLabelText("New password"), "Rentify123!");
      await user.type(
        screen.getByLabelText("Confirm new password"),
        "Rentify123!",
      );
      await user.click(screen.getByRole("button", { name: "Set password" }));

      expect(
        await screen.findByText(
          "This account already has a password. Use the change password option instead.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("resolves the mode itself when no hasPassword prop is given", async () => {
    linkedOAuthProvidersMock.mockResolvedValue({
      hasPassword: false,
      providers: [],
    });

    render(<HomePasswordPanel />);

    expect(
      await screen.findByRole("button", { name: "Set password" }),
    ).toBeInTheDocument();
    expect(linkedOAuthProvidersMock).toHaveBeenCalled();
    expect(screen.queryByLabelText("Current password")).toBeNull();
  });
});
