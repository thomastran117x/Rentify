import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("renders the brand, navigation groups, social links, and current year", () => {
    render(<SiteFooter />);

    expect(screen.getByText(/Search, compare, and manage rental postings/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Rentify/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Instagram" })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(String(new Date().getFullYear())))).toBeInTheDocument();
    expect(screen.getByText("Built for renters, by renters.")).toBeInTheDocument();
  });
});
