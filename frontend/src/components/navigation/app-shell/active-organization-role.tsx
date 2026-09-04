"use client";

// One-way bridge carrying the viewer's organization role out of the workspace
// provider so the app-shell sidebar can gate the nested Organizations sections.
//
// The sidebar lives in the root layout and therefore cannot call
// `useOrganizationWorkspace()`. Reading `session.user.activeOrganization?.role`
// instead is not sufficient: the workspace falls back to `memberships[0]` when
// no active organization is set server-side, so the session value can be
// undefined while the workspace is happily rendering sections. `WorkspaceChrome`
// publishes its resolved `detail.viewerRole` here, and the sidebar falls back to
// the session value only when nothing has been published.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { OrganizationRole } from "@/lib/organizations/api";

const ActiveOrganizationRoleContext = createContext<
  OrganizationRole | undefined
>(undefined);

const PublishActiveOrganizationRoleContext = createContext<
  ((role?: OrganizationRole) => void) | null
>(null);

export function ActiveOrganizationRoleProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [role, setRole] = useState<OrganizationRole | undefined>(undefined);
  const publish = useMemo(() => setRole, [setRole]);

  return (
    <PublishActiveOrganizationRoleContext.Provider value={publish}>
      <ActiveOrganizationRoleContext.Provider value={role}>
        {children}
      </ActiveOrganizationRoleContext.Provider>
    </PublishActiveOrganizationRoleContext.Provider>
  );
}

export function useActiveOrganizationRole(): OrganizationRole | undefined {
  return useContext(ActiveOrganizationRoleContext);
}

/**
 * Publish the current organization role while the caller is mounted, and clear
 * it on unmount so a stale role never outlives the workspace.
 */
export function usePublishActiveOrganizationRole(role?: OrganizationRole) {
  const publish = useContext(PublishActiveOrganizationRoleContext);

  useEffect(() => {
    if (!publish) {
      return;
    }

    publish(role);

    return () => publish(undefined);
  }, [publish, role]);
}
