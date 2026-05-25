import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketingHeroSearch } from "./marketing-hero-search";
import { routerPushMock, resetRouterMocks } from "@/test/mocks/next-navigation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock("@/components/postings/posting-autocomplete-input", () => ({
  PostingAutocompleteInput: ({
    label,
    placeholder,
  }: {
    label: string;
    placeholder: string;
  }) => (
    <label>
      {label}
      <input name="q" aria-label={label} placeholder={placeholder} />
    </label>
  ),
}));

describe("MarketingHeroSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
  });

  it("navigates to postings when the search is blank", async () => {
    const user = userEvent.setup();

    render(<MarketingHeroSearch />);

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(routerPushMock).toHaveBeenCalledWith("/postings");
  });

  it("submits a trimmed search query", async () => {
    const user = userEvent.setup();

    render(<MarketingHeroSearch />);

    await user.type(
      screen.getByRole("textbox", { name: "Search the marketplace" }),
      "  camera gear  ",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(routerPushMock).toHaveBeenCalledWith(
      "/postings?q=camera%20gear",
    );
  });

  it("navigates from a suggested search chip", async () => {
    const user = userEvent.setup();

    render(<MarketingHeroSearch />);

    await user.click(screen.getByRole("button", { name: "Equipment" }));

    expect(routerPushMock).toHaveBeenCalledWith("/postings?q=Equipment");
  });
});
