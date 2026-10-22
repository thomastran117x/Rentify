import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordRequirementsChecklist } from "./password-requirements-checklist";

function rowStates() {
  const list = screen.getByRole("list", { name: "Password requirements" });

  return Object.fromEntries(
    within(list)
      .getAllByRole("listitem")
      .map((item) => [
        item.textContent?.replace(/ \((not )?met\)$/, ""),
        item.dataset.state,
      ]),
  );
}

describe("PasswordRequirementsChecklist", () => {
  it("lists every requirement as pending before anything is typed", () => {
    render(<PasswordRequirementsChecklist id="requirements" password="" />);

    expect(rowStates()).toEqual({
      "At least 8 characters": "pending",
      "An uppercase letter": "pending",
      "A lowercase letter": "pending",
      "A number": "pending",
      "A special character": "pending",
    });
    expect(screen.getAllByText("(not met)")).toHaveLength(5);
  });

  it("ticks off only the requirements the password meets", () => {
    render(
      <PasswordRequirementsChecklist id="requirements" password="password123" />,
    );

    expect(rowStates()).toEqual({
      "At least 8 characters": "met",
      "An uppercase letter": "pending",
      "A lowercase letter": "met",
      "A number": "met",
      "A special character": "pending",
    });
  });

  it("marks every requirement met for a strong password", () => {
    render(
      <PasswordRequirementsChecklist id="requirements" password="Abcdefg1!" />,
    );

    expect(Object.values(rowStates())).toEqual(Array(5).fill("met"));
    expect(screen.getAllByText("(met)")).toHaveLength(5);
  });

  it("flags only the missing requirements once the password is invalid", () => {
    render(
      <PasswordRequirementsChecklist
        id="requirements"
        password="password123"
        invalid
      />,
    );

    expect(rowStates()).toEqual({
      "At least 8 characters": "met",
      "An uppercase letter": "unmet",
      "A lowercase letter": "met",
      "A number": "met",
      "A special character": "unmet",
    });
  });
});
