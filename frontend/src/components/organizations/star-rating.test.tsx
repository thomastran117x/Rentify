import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StarRating, StarRatingInput } from "./star-rating";

describe("StarRating", () => {
  it("exposes the rounded value via an accessible label", () => {
    render(<StarRating value={4.2} />);
    expect(
      screen.getByRole("img", { name: "Rated 4.2 out of 5" }),
    ).toBeInTheDocument();
  });
});

describe("StarRatingInput", () => {
  it("renders one radio per star and marks the selected value", () => {
    render(<StarRatingInput value={3} onChange={() => undefined} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "3 stars" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("calls onChange with the clicked star value", async () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={0} onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: "5 stars" }));

    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("does not fire onChange when disabled", async () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={0} onChange={onChange} disabled />);

    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
