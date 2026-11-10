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

    expect(rowStates()).toEqual({ "At least 12 characters": "pending" });
    expect(screen.getAllByText("(not met)")).toHaveLength(1);
  });

  it("stays pending below 12 characters", () => {
    render(
      <PasswordRequirementsChecklist
        id="requirements"
        password="password123"
      />,
    );

    expect(rowStates()).toEqual({ "At least 12 characters": "pending" });
  });

  it("marks the requirement met at 12 characters", () => {
    render(
      <PasswordRequirementsChecklist
        id="requirements"
        password="tidal harbor"
      />,
    );

    expect(rowStates()).toEqual({ "At least 12 characters": "met" });
    expect(screen.getAllByText("(met)")).toHaveLength(1);
  });

  it("flags the missing requirement once the password is invalid", () => {
    render(
      <PasswordRequirementsChecklist
        id="requirements"
        password="password123"
        invalid
      />,
    );

    expect(rowStates()).toEqual({ "At least 12 characters": "unmet" });
  });
});
