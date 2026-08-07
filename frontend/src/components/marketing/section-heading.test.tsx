import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionHeading } from "./section-heading";

describe("SectionHeading", () => {
  it("renders the optional content and centered layout", () => {
    render(
      <SectionHeading
        eyebrow="Insights"
        title="A clearer rental experience"
        description="Useful details before a booking."
        align="center"
        action={<button type="button">Read more</button>}
      />,
    );

    expect(screen.getByText("Insights")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A clearer rental experience" })).toBeInTheDocument();
    expect(screen.getByText("Useful details before a booking.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read more" })).toBeInTheDocument();
    expect(screen.getByRole("heading").parentElement).toHaveClass("text-center");
  });

  it("omits optional elements and uses the left layout by default", () => {
    render(<SectionHeading title="Only a title" />);

    expect(screen.getByRole("heading", { name: "Only a title" }).parentElement).not.toHaveClass("text-center");
    expect(screen.queryByText("Insights")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
