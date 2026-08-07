import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./theme-toggle";

const useThemeMock = vi.fn();

vi.mock("@/lib/theme/use-theme", () => ({
  useTheme: () => useThemeMock(),
}));

describe("ThemeToggle", () => {
  it("renders the light-mode action and toggles the theme", async () => {
    const toggle = vi.fn();
    useThemeMock.mockReturnValue({ theme: "dark", toggle });
    const user = userEvent.setup();

    render(<ThemeToggle className="extra" />);

    const button = screen.getByRole("button", { name: "Switch to light mode" });
    expect(button).toHaveClass("extra");
    await user.click(button);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("renders the dark-mode action", () => {
    useThemeMock.mockReturnValue({ theme: "light", toggle: vi.fn() });

    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
  });
});
