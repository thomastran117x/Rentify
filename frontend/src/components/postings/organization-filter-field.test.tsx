import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizationFilterField } from "./organization-filter-field";

function readHiddenOrganizationId(container: HTMLElement): string | null {
  return (
    container.querySelector<HTMLInputElement>('input[name="organizationId"]')
      ?.value ?? null
  );
}

describe("OrganizationFilterField", () => {
  it("keeps the visitor's own text for a name search", () => {
    const { container } = render(
      <OrganizationFilterField defaultValue="Organization" inputClassName="" />,
    );

    // A partial query must survive resubmission, or a multi-organization
    // filter would silently narrow to whichever match came back first.
    expect(screen.getByRole("textbox")).toHaveValue("Organization");
    expect(readHiddenOrganizationId(container)).toBeNull();
  });

  it("resubmits the exact organization id while the field is untouched", () => {
    const { container } = render(
      <OrganizationFilterField
        defaultValue="Maya Santos Organization"
        organizationId="org-1"
        inputClassName=""
      />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("Maya Santos Organization");
    expect(readHiddenOrganizationId(container)).toBe("org-1");
  });

  it("drops the exact organization id once the visitor edits the name", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <OrganizationFilterField
        defaultValue="Maya Santos Organization"
        organizationId="org-1"
        inputClassName=""
      />,
    );

    await user.type(screen.getByRole("textbox"), " Rentals");

    // Editing means "search by this name", so the id must not override it.
    expect(readHiddenOrganizationId(container)).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue(
      "Maya Santos Organization Rentals",
    );
  });

  it("restores the exact organization id when the edit is undone", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <OrganizationFilterField
        defaultValue="Maya"
        organizationId="org-1"
        inputClassName=""
      />,
    );

    const input = screen.getByRole("textbox");
    await user.type(input, "!");
    expect(readHiddenOrganizationId(container)).toBeNull();

    await user.type(input, "{backspace}");
    expect(readHiddenOrganizationId(container)).toBe("org-1");
  });

  it("clears the filter entirely when the field is emptied", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <OrganizationFilterField
        defaultValue="Maya Santos Organization"
        organizationId="org-1"
        inputClassName=""
      />,
    );

    await user.clear(screen.getByRole("textbox"));

    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(readHiddenOrganizationId(container)).toBeNull();
  });
});
