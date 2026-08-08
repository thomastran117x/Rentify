import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoginFormCard } from "./login-form-card";
import { SignupFormCard } from "./signup-form-card";

describe("authentication form cards", () => {
  it("renders login guidance and signup navigation", () => {
    render(
      <LoginFormCard>
        <form aria-label="Login form" />
      </LoginFormCard>,
    );
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/signup");
  });

  it("renders signup guidance and login navigation", () => {
    render(
      <SignupFormCard>
        <form aria-label="Signup form" />
      </SignupFormCard>,
    );
    expect(
      screen.getByRole("heading", { name: "Sign up" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to sign in" }),
    ).toHaveAttribute("href", "/login");
  });
});
