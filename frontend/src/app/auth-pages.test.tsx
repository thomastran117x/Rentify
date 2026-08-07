import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./login/page";
import SignupPage from "./signup/page";
import GoogleOAuthCallbackPage from "./auth/google/page";
import MicrosoftOAuthCallbackPage from "./auth/microsoft/page";

vi.mock("@/components/auth/auth-page-shell", () => ({
  AuthPageShell: ({ children, variant }: { children: React.ReactNode; variant: string }) => <main data-variant={variant}>{children}</main>,
}));
vi.mock("@/components/auth/login-form-card", () => ({ LoginFormCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/auth/signup-form-card", () => ({ SignupFormCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/auth/login-form", () => ({
  LoginForm: ({ nextPath, initialRecoveryOpen }: { nextPath: string; initialRecoveryOpen: boolean }) => <div>Login {nextPath} {String(initialRecoveryOpen)}</div>,
}));
vi.mock("@/components/auth/signup-form", () => ({ SignupForm: ({ nextPath }: { nextPath: string }) => <div>Signup {nextPath}</div> }));
vi.mock("@/components/auth/oauth-popup-finish", () => ({ OAuthPopupFinish: () => <div>OAuth complete</div> }));

describe("authentication routes", () => {
  it("passes login redirect and recovery parameters to the form", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ next: "/account", recovery: "account" }) }));
    expect(screen.getByText("Login /account true")).toBeInTheDocument();
  });

  it("uses default paths when auth route parameters are absent", async () => {
    render(await LoginPage({}));
    expect(screen.getByText("Login / false")).toBeInTheDocument();
    render(await SignupPage({}));
    expect(screen.getByText("Signup /")).toBeInTheDocument();
  });

  it("passes the signup redirect and renders both OAuth callbacks", async () => {
    render(await SignupPage({ searchParams: Promise.resolve({ next: "/postings/create" }) }));
    expect(screen.getByText("Signup /postings/create")).toBeInTheDocument();
    render(<GoogleOAuthCallbackPage />);
    render(<MicrosoftOAuthCallbackPage />);
    expect(screen.getAllByText("OAuth complete")).toHaveLength(2);
  });
});
