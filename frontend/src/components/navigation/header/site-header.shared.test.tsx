import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  UserAvatar,
  getAccountLinks,
  getDisplayLabel,
  isRouteActive,
} from "./site-header.shared";

describe("site header shared helpers", () => {
  it("returns owner dashboard links only for owner-capable roles", () => {
    const ownerLinks = getAccountLinks("owner");
    const moderatorLinks = getAccountLinks("moderator");
    const userLinks = getAccountLinks("user");

    expect(ownerLinks.some((link) => link.href === "/dashboard")).toBe(true);
    expect(ownerLinks.some((link) => link.href === "/postings/create")).toBe(
      true,
    );
    expect(moderatorLinks.some((link) => link.href === "/dashboard")).toBe(
      false,
    );
    expect(userLinks.some((link) => link.href === "/dashboard")).toBe(false);
  });

  it("shows create posting for manager-capable active organizations", () => {
    const managerLinks = getAccountLinks("user", {
      activeOrganization: {
        id: "org-1",
        name: "Org 1",
        role: "manager",
      },
    });
    const operatorLinks = getAccountLinks("user", {
      activeOrganization: {
        id: "org-1",
        name: "Org 1",
        role: "operator",
      },
    });

    expect(managerLinks.some((link) => link.href === "/postings/create")).toBe(
      true,
    );
    expect(operatorLinks.some((link) => link.href === "/postings/create")).toBe(
      false,
    );
  });

  it("shows the postings dashboard link only when an organization is active", () => {
    const withOrg = getAccountLinks("user", {
      activeOrganization: { id: "org-1", name: "Org 1", role: "operator" },
    });
    const withoutOrg = getAccountLinks("user");

    expect(withOrg.some((link) => link.href === "/postings/manage")).toBe(true);
    expect(withoutOrg.some((link) => link.href === "/postings/manage")).toBe(
      false,
    );
  });

  it("returns moderation links for moderator-capable roles", () => {
    const moderatorLinks = getAccountLinks("moderator");
    const adminLinks = getAccountLinks("admin");
    const ownerLinks = getAccountLinks("owner");

    expect(moderatorLinks.some((link) => link.href === "/moderation")).toBe(
      true,
    );
    expect(adminLinks.some((link) => link.href === "/moderation")).toBe(true);
    expect(ownerLinks.some((link) => link.href === "/moderation")).toBe(false);
  });

  it("does not include dead account routes", () => {
    const links = getAccountLinks("user");

    expect(links.some((link) => link.href === "/profile")).toBe(false);
    expect(links.some((link) => link.href === "/settings")).toBe(false);
  });

  it("shows the organizations link for authenticated users regardless of org context", () => {
    const linksWithoutOrg = getAccountLinks("user");
    const linksWithMembership = getAccountLinks("user", {
      organizationMembershipCount: 1,
    });
    const linksWithActiveOrg = getAccountLinks("user", {
      hasActiveOrganization: true,
    });

    expect(linksWithoutOrg.some((link) => link.href === "/dashboard/organizations")).toBe(
      true,
    );
    expect(
      linksWithMembership.some((link) => link.href === "/dashboard/organizations"),
    ).toBe(true);
    expect(
      linksWithActiveOrg.some((link) => link.href === "/dashboard/organizations"),
    ).toBe(true);
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
