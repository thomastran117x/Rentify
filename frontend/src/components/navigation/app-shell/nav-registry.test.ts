import { describe, expect, it } from "vitest";
import type { ActiveOrganizationSummary } from "@/lib/auth/types";
import {
  APP_NAV_ITEMS,
  findActiveNavItem,
  getAccessibleNavItems,
  isWorkspaceRoute,
  redirectsAnonymousVisitors,
} from "./nav-registry";

function org(
  role: ActiveOrganizationSummary["role"],
): ActiveOrganizationSummary {
  return { id: "org-1", name: "Org 1", role };
}

function hrefs(...args: Parameters<typeof getAccessibleNavItems>): string[] {
  return getAccessibleNavItems(...args).map((item) => item.href);
}

describe("isWorkspaceRoute", () => {
  it.each([
    "/dashboard",
    "/dashboard/postings/abc",
    "/dashboard/organizations",
    "/dashboard/organizations/team",
    "/postings/manage",
    "/postings/create",
    "/bookings",
    "/bookings/abc",
    "/rentings/abc",
    "/saved",
    "/saved/searches",
    "/moderation",
    "/account",
  ])("renders the shell on %s", (pathname) => {
    expect(isWorkspaceRoute(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/postings",
    "/postings/abc",
    "/blog",
    "/login",
    "/signup",
    "/about",
    "/organizations/xyz",
  ])("leaves %s header-only", (pathname) => {
    expect(isWorkspaceRoute(pathname)).toBe(false);
  });
});

describe("getAccessibleNavItems", () => {
  it("returns owner dashboard links only for owner-capable roles", () => {
    expect(hrefs({ role: "owner" })).toContain("/dashboard");
    expect(hrefs({ role: "owner" })).toContain("/postings/create");
    expect(hrefs({ role: "admin" })).toContain("/dashboard");
    expect(hrefs({ role: "moderator" })).not.toContain("/dashboard");
    expect(hrefs({ role: "user" })).not.toContain("/dashboard");
  });

  it("shows create posting for manager-capable active organizations", () => {
    expect(
      hrefs({ role: "user", activeOrganization: org("manager") }),
    ).toContain("/postings/create");
    expect(
      hrefs({ role: "user", activeOrganization: org("primary_manager") }),
    ).toContain("/postings/create");
    expect(
      hrefs({ role: "user", activeOrganization: org("operator") }),
    ).not.toContain("/postings/create");
  });

  it("shows the postings dashboard link only when an organization is active", () => {
    expect(
      hrefs({ role: "user", activeOrganization: org("operator") }),
    ).toContain("/postings/manage");
    expect(hrefs({ role: "user" })).not.toContain("/postings/manage");
  });

  it("returns moderation links for moderator-capable roles", () => {
    expect(hrefs({ role: "moderator" })).toContain("/moderation");
    expect(hrefs({ role: "admin" })).toContain("/moderation");
    expect(hrefs({ role: "owner" })).not.toContain("/moderation");
  });

  it("shows organizations, account, and personal activity to every role", () => {
    for (const role of ["user", "owner", "moderator", "admin"] as const) {
      const visible = hrefs({ role });

      expect(visible).toContain("/dashboard/organizations");
      expect(visible).toContain("/account");
      expect(visible).toContain("/bookings");
      expect(visible).toContain("/saved");
      expect(visible).toContain("/saved/searches");
    }
  });

  it("does not include dead account routes", () => {
    expect(APP_NAV_ITEMS.map((item) => item.href)).not.toContain("/profile");
    expect(APP_NAV_ITEMS.map((item) => item.href)).not.toContain("/settings");
  });
});

describe("findActiveNavItem", () => {
  it.each([
    ["/dashboard", "dashboard"],
    ["/dashboard/postings/abc", "dashboard"],
    ["/dashboard/organizations", "organizations"],
    // Nested under both /dashboard and /dashboard/organizations — the deeper
    // prefix must win.
    ["/dashboard/organizations/team", "organizations"],
    ["/saved", "saved"],
    ["/saved/searches", "saved-searches"],
    ["/rentings/abc", "bookings"],
    ["/bookings/abc", "bookings"],
    ["/postings/manage", "postings"],
    ["/postings/create", "create-posting"],
    ["/account", "account"],
  ])("marks %s active as %s", (pathname, expected) => {
    expect(findActiveNavItem(pathname)?.id).toBe(expected);
  });

  it("returns nothing for routes outside the shell", () => {
    expect(findActiveNavItem("/postings")).toBeUndefined();
    expect(findActiveNavItem("/blog")).toBeUndefined();
    expect(findActiveNavItem("/")).toBeUndefined();
  });
});

describe("redirectsAnonymousVisitors", () => {
  it.each([
    "/dashboard",
    "/dashboard/organizations/team",
    "/postings/manage",
    "/postings/create",
    "/bookings",
    "/bookings/abc",
    "/rentings/abc",
    "/moderation",
  ])("sends signed-out visitors away from %s", (pathname) => {
    expect(redirectsAnonymousVisitors(pathname)).toBe(true);
  });

  // These render their own sign-in prompt instead of redirecting, so the rail
  // must not be reserved for them while auth is still resolving.
  it.each(["/saved", "/saved/searches", "/account"])(
    "keeps %s visible to signed-out visitors",
    (pathname) => {
      expect(redirectsAnonymousVisitors(pathname)).toBe(false);
    },
  );
});
