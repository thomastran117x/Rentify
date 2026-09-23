import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthSignupDateOfBirthDialog } from "./oauth-signup-date-of-birth-dialog";

const { completeOAuthSignupMock } = vi.hoisted(() => ({
  completeOAuthSignupMock: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: { completeOAuthSignup: completeOAuthSignupMock },
}));

const pendingSignup = {
  signupRequired: true as const,
  signupToken: "signup-token",
  expiresInSeconds: 600,
};

describe("OAuthSignupDateOfBirthDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a date without imposing a minimum age", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    completeOAuthSignupMock.mockResolvedValue({ accessToken: "access-token" });
    render(
      <OAuthSignupDateOfBirthDialog
        pendingSignup={pendingSignup}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Date of birth is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Date of birth"), {
      target: { value: "2012-06-15" },
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(completeOAuthSignupMock).toHaveBeenCalledWith({
        signupToken: "signup-token",
        dateOfBirth: "2012-06-15",
      }),
    );
    expect(onSuccess).toHaveBeenCalledWith({ accessToken: "access-token" });
  });

  it("cancels without completing signup", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <OAuthSignupDateOfBirthDialog
        pendingSignup={pendingSignup}
        onSuccess={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
    expect(completeOAuthSignupMock).not.toHaveBeenCalled();
  });
});
