import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));
vi.mock("@/components/postings/posting-autocomplete-input", () => ({
  PostingAutocompleteInput: ({ label }: { label: string }) => (
    <label>
      {label}
      <input name="q" />
    </label>
  ),
}));

describe("Home", () => {
  it("renders marketplace content and searches with both query fields", async () => {
    const user = userEvent.setup();
    render(<Home />);

    expect(screen.getByRole("heading", { name: "Find the right rental without the clutter." })).toBeInTheDocument();
    expect(screen.getByText("Downtown studio workspace")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /How it works See the renter/ })).toHaveAttribute("href", "/how-it-works");

    await user.type(screen.getByRole("textbox", { name: "Search rentals" }), "camera kit");
    await user.type(screen.getByRole("textbox", { name: "Location" }), " Ottawa ");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(routerPushMock).toHaveBeenCalledWith("/postings?q=camera+kit&location=Ottawa");
  });

  it("searches the unfiltered postings route when no fields are supplied", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(routerPushMock).toHaveBeenCalledWith("/postings");
  });
});
