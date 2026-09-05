import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  ActiveOrganizationSummary,
  AuthResponseUser,
  StoredAuthSession,
} from "@/lib/auth/types";
import type { OrganizationRole } from "@/lib/organizations/api";
import {
  ActiveOrganizationRoleProvider,
  usePublishActiveOrganizationRole,
} from "./active-organization-role";
import { AppSidebar } from "./app-sidebar";

function PublishRole({
  role,
  children,
}: {
  role?: OrganizationRole;
  children: ReactNode;
}) {
  usePublishActiveOrganizationRole(role);
  return <>{children}</>;
}

function makeSession(
  role: AuthResponseUser["role"],
  activeOrganization?: ActiveOrganizationSummary,
): StoredAuthSession {
  return {
    accessToken: "token",
    device: { known: true, knownByIp: false },
    user: {
      id: "user-1",
      email: "person@example.com",
      username: "person",
      role,
      activeOrganization,
    },
  } as StoredAuthSession;
}

function org(role: OrganizationRole): ActiveOrganizationSummary {
  return { id: "org-1", name: "Org 1", role };
}

function renderSidebar(props: {
  pathname: string;
  status?: "loading" | "anonymous" | "authenticated";
  session?: StoredAuthSession | null;
  publishedRole?: OrganizationRole;
}) {
  const {
    pathname,
    status = "authenticated",
    session = makeSession("user"),
    publishedRole,
  } = props;

  return render(
    <ActiveOrganizationRoleProvider>
      <PublishRole role={publishedRole}>
        <AppSidebar pathname={pathname} status={status} session={session} />
      </PublishRole>
    </ActiveOrganizationRoleProvider>,
  );
}

function workspaceNav() {
  return screen.getByRole("navigation", { name: "Workspace" });
}

function sectionNav() {
  return screen.queryByRole("navigation", {
    name: "Organization workspace sections",
  });
}

function labels(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole("link")
    .map((link) => link.textContent?.trim() ?? "");
}

describe("AppSidebar", () => {
  it("renders a skeleton rail while auth is still loading", () => {
    const { container } = renderSidebar({
      pathname: "/dashboard",
      status: "loading",
    });

    expect(
      screen.queryByRole("navigation", { name: "Workspace" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
  });

  // The placeholder is rendered on every shell route so server and client
  // markup match; whether it takes up space is decided by CSS from the
  // pre-paint auth hint, which is what keeps the width stable for both
  // eventual outcomes.
  it.each(["/dashboard", "/saved", "/saved/searches", "/account"])(
    "marks the loading rail on %s for the auth hint to gate",
    (pathname) => {
      const { container } = renderSidebar({ pathname, status: "loading" });

      expect(container.querySelector("aside")).toHaveAttribute(
        "data-auth-skeleton",
      );
    },
  );

  // Below `lg` the resolved rail grows a second strip row inside the
  // organization workspace, so the placeholder must claim the same two rows or
  // the sticky bar changes height and pushes the page down.
  it("gives the loading rail a second row on organization routes", () => {
    const { container } = renderSidebar({
      pathname: "/dashboard/organizations/team",
      status: "loading",
    });

    const rows = container.querySelectorAll("aside > div");
    expect(rows).toHaveLength(2);
  });

  it("keeps the loading rail to a single row elsewhere", () => {
    const { container } = renderSidebar({
      pathname: "/dashboard",
      status: "loading",
    });

    expect(container.querySelectorAll("aside > div")).toHaveLength(1);
  });

  it("renders nothing for anonymous visitors mid-redirect", () => {
    const { container } = renderSidebar({
      pathname: "/dashboard",
      status: "anonymous",
      session: null,
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("shows owner destinations and hides moderation for an owner", () => {
    renderSidebar({ pathname: "/dashboard", session: makeSession("owner") });

    const nav = workspaceNav();
    expect(labels(nav)).toEqual(
      expect.arrayContaining([
        "Dashboard",
        "Create posting",
        "Bookings",
        "Saved",
        "Saved searches",
        "Organizations",
        "Manage account",
      ]),
    );
    expect(labels(nav)).not.toContain("Moderation");
  });

  it("shows moderation only for moderator-capable roles", () => {
    const { unmount } = renderSidebar({
      pathname: "/moderation",
      session: makeSession("moderator"),
    });
    expect(labels(workspaceNav())).toContain("Moderation");
    unmount();

    renderSidebar({ pathname: "/moderation", session: makeSession("user") });
    expect(labels(workspaceNav())).not.toContain("Moderation");
  });

  it("gates org-scoped destinations on the active organization role", () => {
    const { unmount } = renderSidebar({
      pathname: "/account",
      session: makeSession("user", org("operator")),
    });
    expect(labels(workspaceNav())).toContain("Postings");
    expect(labels(workspaceNav())).not.toContain("Create posting");
    unmount();

    renderSidebar({
      pathname: "/account",
      session: makeSession("user", org("manager")),
    });
    expect(labels(workspaceNav())).toContain("Postings");
    expect(labels(workspaceNav())).toContain("Create posting");
  });

  it("marks exactly one item as the current page", () => {
    renderSidebar({ pathname: "/bookings/abc", session: makeSession("owner") });

    const current = within(workspaceNav()).getAllByRole("link", {
      current: "page",
    });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Bookings");
  });

  it("does not render the organization sections outside the workspace", () => {
    renderSidebar({
      pathname: "/bookings",
      session: makeSession("user", org("primary_manager")),
    });

    expect(sectionNav()).not.toBeInTheDocument();
  });

  it("expands the organization sections in place, gated by org role", () => {
    const { unmount } = renderSidebar({
      pathname: "/dashboard/organizations/team",
      session: makeSession("user", org("primary_manager")),
    });

    const sections = sectionNav();
    expect(sections).toBeInTheDocument();
    expect(labels(sections as HTMLElement)).toEqual([
      "Overview",
      "Team",
      "Content",
      "Postings",
      "Activity",
      "Settings",
    ]);
    unmount();

    renderSidebar({
      pathname: "/dashboard/organizations/team",
      session: makeSession("user", org("manager")),
    });
    expect(labels(sectionNav() as HTMLElement)).not.toContain("Settings");
    unmount();
  });

  it("hides activity and settings from an operator", () => {
    renderSidebar({
      pathname: "/dashboard/organizations/overview",
      session: makeSession("user", org("operator")),
    });

    const visible = labels(sectionNav() as HTMLElement);
    expect(visible).not.toContain("Activity");
    expect(visible).not.toContain("Settings");
    expect(visible).toContain("Overview");
  });

  it("omits the sections entirely when the viewer has no organization role", () => {
    renderSidebar({
      pathname: "/dashboard/organizations",
      session: makeSession("user"),
    });

    expect(sectionNav()).not.toBeInTheDocument();
  });

  it("prefers the published workspace role over the session role", () => {
    renderSidebar({
      pathname: "/dashboard/organizations/overview",
      // The session has no active organization, which alone would hide every
      // section — the workspace publishes the resolved role instead.
      session: makeSession("user"),
      publishedRole: "primary_manager",
    });

    expect(labels(sectionNav() as HTMLElement)).toContain("Settings");
  });

  it("marks the section leaf current, not the Organizations parent", () => {
    renderSidebar({
      pathname: "/dashboard/organizations/team",
      session: makeSession("user", org("manager")),
    });

    const current = within(workspaceNav()).getAllByRole("link", {
      current: "page",
    });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Team");
  });
});
