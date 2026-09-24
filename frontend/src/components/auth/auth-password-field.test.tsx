import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthPasswordField } from "./auth-password-field";

function renderField(
  props: Partial<Parameters<typeof AuthPasswordField>[0]> = {},
) {
  const onChange = vi.fn();
  const result = render(
    <AuthPasswordField
      id="password"
      label="Password"
      value=""
      onChange={onChange}
      autoComplete="new-password"
      {...props}
    />,
  );

  return { ...result, onChange };
}

describe("AuthPasswordField", () => {
  it("masks the value until the toggle is pressed", async () => {
    const user = userEvent.setup();
    renderField({ value: "hunter2" });

    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);

    expect(input).toHaveAttribute("type", "text");
    const pressed = screen.getByRole("button", { name: "Hide password" });
    expect(pressed).toHaveAttribute("aria-pressed", "true");

    await user.click(pressed);
    expect(input).toHaveAttribute("type", "password");
  });

  it("reports each keystroke to the caller", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();

    await user.type(screen.getByLabelText("Password"), "a");

    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("shows the hint until an error replaces it", () => {
    const { rerender } = renderField({ hint: "At least 8 characters." });

    expect(screen.getByText("At least 8 characters.")).toBeInTheDocument();

    rerender(
      <AuthPasswordField
        id="password"
        label="Password"
        value=""
        onChange={vi.fn()}
        autoComplete="new-password"
        hint="At least 8 characters."
        error="Password is required."
        errorId="signup-password-error"
      />,
    );

    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(
      screen.queryByText("At least 8 characters."),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-describedby",
      "signup-password-error",
    );
  });

  it("renders a label action next to the label", () => {
    renderField({
      labelAction: <button type="button">I can&apos;t log in</button>,
    });

    expect(
      screen.getByRole("button", { name: "I can't log in" }),
    ).toBeInTheDocument();
  });
});
