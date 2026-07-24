import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InstantBookBadge } from "./instant-book-badge";

describe("InstantBookBadge", () => {
  it("renders the label when instant booking is enabled", () => {
    render(<InstantBookBadge instantBooking />);

    expect(screen.getByText("Instant Book")).toBeInTheDocument();
  });

  it("renders nothing when instant booking is disabled or undefined", () => {
    const { container, rerender } = render(
      <InstantBookBadge instantBooking={false} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<InstantBookBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});
