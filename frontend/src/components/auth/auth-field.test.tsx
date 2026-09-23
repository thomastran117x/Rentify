import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthField } from "./auth-field";

function renderField(props: Partial<Parameters<typeof AuthField>[0]> = {}) {
  return render(
    <AuthField
      id="username"
      label="Username"
      hasValue={false}
      icon={<span data-testid="field-icon" />}
      {...props}
    >
      <input id="username" />
    </AuthField>,
  );
}

describe("AuthField", () => {
  it("associates the label with the control the caller supplies", () => {
    renderField();

    expect(screen.getByLabelText("Username")).toBe(
      document.getElementById("username"),
    );
    expect(screen.getByTestId("field-icon")).toBeInTheDocument();
  });

  it("renders the hint when there is no error", () => {
    renderField({ hint: "Letters, numbers, and hyphens." });

    expect(
      screen.getByText("Letters, numbers, and hyphens."),
    ).toBeInTheDocument();
  });

  it("replaces the hint with the error message", () => {
    renderField({
      hint: "Letters, numbers, and hyphens.",
      error: "Username is required.",
    });

    expect(screen.getByText("Username is required.")).toBeInTheDocument();
    expect(
      screen.queryByText("Letters, numbers, and hyphens."),
    ).not.toBeInTheDocument();
  });

  it("gives the error message the caller's id so aria-describedby can target it", () => {
    renderField({
      error: "Username is required.",
      errorId: "signup-username-error",
    });

    expect(screen.getByText("Username is required.").closest("[id]")?.id).toBe(
      "signup-username-error",
    );
  });

  it("falls back to an id derived from the field id", () => {
    renderField({ error: "Username is required." });

    expect(screen.getByText("Username is required.").closest("[id]")?.id).toBe(
      "username-error",
    );
  });

  it("renders a label action alongside the label", () => {
    renderField({ labelAction: <button type="button">Why we ask</button> });

    expect(
      screen.getByRole("button", { name: "Why we ask" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
  });
});
