"use client";

import Link from "next/link";
import type { StoredAuthSession } from "@/lib/auth/types";
import { isRouteActive } from "@/lib/navigation/is-route-active";
import {
  getAccessibleSections,
  type WorkspaceSection,
} from "@/components/organizations/workspace/section-registry";
import { theme } from "@/styles/theme";
import { useActiveOrganizationRole } from "./active-organization-role";
import {
  APP_NAV_GROUPS,
  findActiveNavItem,
  getAccessibleNavItems,
  type AppNavItem,
} from "./nav-registry";

const ORGANIZATIONS_HREF = "/dashboard/organizations";

interface AppSidebarProps {
  pathname: string;
  status: "loading" | "anonymous" | "authenticated";
  session: StoredAuthSession | null;
}

function SidebarSkeleton({ withSections }: { withSections: boolean }) {
  return (
    // `data-auth-skeleton` lets CSS drop this from layout when the pre-paint
    // auth hint says there is no stored session. Rendering the markup
    // unconditionally keeps server and client output identical.
    <aside
      className={theme.sidebar.shell}
      aria-hidden="true"
      data-auth-skeleton
    >
      <div className={theme.sidebar.strip}>
        {[0, 1, 2, 3, 4].map((key) => (
          <div key={key} className={theme.sidebar.skeletonItem} />
        ))}
      </div>

      {/* Inside the organization workspace the resolved rail grows a second
          strip row for the section sub-nav. Below `lg` that adds height to the
          sticky bar and would push the page content down, so the placeholder
          has to claim the same two rows. */}
      {withSections ? (
        <div className={theme.sidebar.subList}>
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className={theme.sidebar.skeletonSubItem} />
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function sectionHref(section: WorkspaceSection): string {
  return `${ORGANIZATIONS_HREF}/${section.segment}`;
}

/**
 * The organization workspace's own sections, nested under the Organizations
 * item while the viewer is inside the workspace. Kept as a separately named
 * landmark so assistive tech (and tests) can address it independently of the
 * top-level nav — the sidebar's "Postings" and the workspace's "Postings" are
 * different destinations.
 */
function OrganizationSections({
  pathname,
  sections,
}: {
  pathname: string;
  sections: WorkspaceSection[];
}) {
  return (
    <nav aria-label="Organization workspace sections">
      <ul className={theme.sidebar.subList}>
        {sections.map((section) => {
          const href = sectionHref(section);
          const selected = isRouteActive(pathname, href);
          const Icon = section.icon;

          return (
            <li key={section.id} className="shrink-0 lg:shrink">
              <Link
                href={href}
                aria-current={selected ? "page" : undefined}
                className={
                  selected ? theme.sidebar.subItemActive : theme.sidebar.subItem
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{section.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

interface SidebarItemProps {
  item: AppNavItem;
  active: boolean;
  pathname: string;
  sections: WorkspaceSection[];
  /** Organization route whose role has not resolved yet. */
  sectionsPending: boolean;
}

function SidebarItem({
  item,
  active,
  pathname,
  sections,
  sectionsPending,
}: SidebarItemProps) {
  const Icon = item.icon;
  const isOrganizations = item.id === "organizations";
  const showSections =
    isOrganizations && (sections.length > 0 || sectionsPending);

  return (
    <li
      className={
        showSections
          ? "flex w-full shrink-0 flex-col gap-1 lg:w-auto"
          : "shrink-0 lg:shrink"
      }
    >
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={active ? theme.sidebar.itemActive : theme.sidebar.item}
      >
        <Icon
          className={
            active ? theme.sidebar.itemIconActive : theme.sidebar.itemIcon
          }
        />
        <span>{item.label}</span>
      </Link>

      {showSections ? (
        sections.length > 0 ? (
          <OrganizationSections pathname={pathname} sections={sections} />
        ) : (
          <div className={theme.sidebar.subList} aria-hidden="true">
            {[0, 1, 2, 3].map((key) => (
              <div key={key} className={theme.sidebar.skeletonSubItem} />
            ))}
          </div>
        )
      ) : null}
    </li>
  );
}

export function AppSidebar({ pathname, status, session }: AppSidebarProps) {
  // The workspace publishes the role it actually resolved; the session value is
  // a fallback for the window before that lands. See `active-organization-role`.
  const { status: roleStatus, role: publishedRole } =
    useActiveOrganizationRole();
  const organizationRole =
    publishedRole ?? session?.user.activeOrganization?.role;

  const items = session
    ? getAccessibleNavItems({
        role: session.user.role,
        activeOrganization: session.user.activeOrganization,
      })
    : [];

  const inOrganizationWorkspace = isRouteActive(pathname, ORGANIZATIONS_HREF);
  const sections = inOrganizationWorkspace
    ? getAccessibleSections(organizationRole)
    : [];
  // A member whose session carries no activeOrganization has no role until the
  // workspace provider falls back to memberships[0] and publishes
  // `detail.viewerRole`. Holding a placeholder row for that window keeps the
  // strip at its eventual height — but only while resolution is genuinely
  // outstanding, so a viewer who belongs to no organization is not left under
  // bars that never resolve.
  const sectionsPending =
    inOrganizationWorkspace &&
    sections.length === 0 &&
    roleStatus === "pending";
  // A visible section already carries `aria-current`, so the Organizations
  // parent must not claim it too — the leaf wins.
  const sectionIsCurrent = sections.some((section) =>
    isRouteActive(pathname, sectionHref(section)),
  );
  const activeItem = findActiveNavItem(pathname);

  if (status === "loading") {
    return <SidebarSkeleton withSections={inOrganizationWorkspace} />;
  }

  // Anonymous visitors either are mid-redirect to /login or are on a page that
  // renders its own sign-in prompt. Either way the rail stays out of the way.
  if (status !== "authenticated" || !session) {
    return null;
  }

  return (
    <aside className={theme.sidebar.shell}>
      <nav aria-label="Workspace">
        <ul className={theme.sidebar.strip}>
          {APP_NAV_GROUPS.map((group) => {
            const groupItems = items.filter((item) => item.group === group.id);

            if (groupItems.length === 0) {
              return null;
            }

            return (
              <li key={group.id} className={theme.sidebar.group}>
                <p
                  id={`app-nav-group-${group.id}`}
                  className={theme.sidebar.groupLabel}
                >
                  {group.label}
                </p>
                <ul
                  aria-labelledby={`app-nav-group-${group.id}`}
                  className={theme.sidebar.groupList}
                >
                  {groupItems.map((item) => (
                    <SidebarItem
                      key={item.id}
                      item={item}
                      active={
                        activeItem?.id === item.id &&
                        !(item.id === "organizations" && sectionIsCurrent)
                      }
                      pathname={pathname}
                      sections={sections}
                      sectionsPending={sectionsPending}
                    />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
