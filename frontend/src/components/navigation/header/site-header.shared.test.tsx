import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  UserAvatar,
  accountMenuLinks,
  getDisplayLabel,
  isRouteActive,
} from "./site-header.shared";

describe("site header shared helpers", () => {
  it("keeps the account menu to identity actions only", () => {
    // Role-gated navigation lives in the app-shell sidebar now; its gating is
    // covered by components/navigation/app-shell/nav-registry.test.ts.
    expect(accountMenuLinks.map((link) => link.href)).toEqual([
      "/account",
      "/dashboard/organizations",
    ]);
  });

  it("does not include navigation or dead routes in the account menu", () => {
    const hrefs = accountMenuLinks.map((link) => link.href);

    for (const href of [
      "/dashboard",
      "/postings/manage",
      "/postings/create",
      "/moderation",
      "/saved",
      "/bookings",
      "/profile",
      "/settings",
    ]) {
      expect(hrefs).not.toContain(href);
    }
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
    render(
      <UserAvatar name="Jane Doe" imageUrl="https://example.com/jane.jpg" />,
    );

    expect(
      screen.getByRole("img", { name: "Jane Doe avatar" }),
    ).toHaveAttribute("src", "https://example.com/jane.jpg");
  });
});
