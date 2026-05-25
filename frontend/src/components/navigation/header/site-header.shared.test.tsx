import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  UserAvatar,
  getAccountLinks,
  getDisplayLabel,
  isRouteActive,
} from "./site-header.shared";

describe("site header shared helpers", () => {
  it("returns owner dashboard links for non-user roles", () => {
    const ownerLinks = getAccountLinks("owner");
    const userLinks = getAccountLinks("user");

    expect(ownerLinks.some((link) => link.href === "/dashboard")).toBe(true);
    expect(ownerLinks.some((link) => link.href === "/postings/create")).toBe(
      true,
    );
    expect(userLinks.some((link) => link.href === "/dashboard")).toBe(false);
  });

  it("prefers username and falls back to the email prefix for display labels", () => {
    expect(getDisplayLabel("person@example.com", "Person Name")).toBe(
      "Person Name",
    );
    expect(getDisplayLabel("person@example.com", "   ")).toBe("person");
  });

  it("matches exact and nested active routes", () => {
    expect(isRouteActive("/postings", "/postings")).toBe(true);
    expect(isRouteActive("/postings/123", "/postings")).toBe(true);
    expect(isRouteActive("/services", "/postings")).toBe(false);
  });

  it("renders initials when no avatar image exists", () => {
    render(<UserAvatar name="Jane Doe" />);

    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("renders an image avatar when an image URL exists", () => {
    render(<UserAvatar name="Jane Doe" imageUrl="https://example.com/jane.jpg" />);

    expect(screen.getByRole("img", { name: "Jane Doe avatar" })).toHaveAttribute(
      "src",
      "https://example.com/jane.jpg",
    );
  });
});
