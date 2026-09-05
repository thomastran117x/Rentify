"use client";

// One-way bridge carrying the viewer's organization role out of the workspace
// provider so the app-shell sidebar can gate the nested Organizations sections.
//
// The sidebar lives in the root layout and therefore cannot call
// `useOrganizationWorkspace()`. Reading `session.user.activeOrganization?.role`
// instead is not sufficient: the workspace falls back to `memberships[0]` when
// no active organization is set server-side, so the session value can be
// undefined while the workspace is happily rendering sections.
//
// The published value carries its own resolution status rather than leaving the
// sidebar to infer it. "No role yet" and "no role, ever" are otherwise the same
// `undefined`, and a viewer who belongs to no organization would sit under a
// placeholder that never resolves.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { OrganizationRole } from "@/lib/organizations/api";

export interface ActiveOrganizationRoleState {
  status: "pending" | "resolved";
  role?: OrganizationRole;
}

const PENDING: ActiveOrganizationRoleState = { status: "pending" };

const ActiveOrganizationRoleContext =
  createContext<ActiveOrganizationRoleState>(PENDING);

const PublishActiveOrganizationRoleContext = createContext<
  ((state: ActiveOrganizationRoleState) => void) | null
>(null);

export function ActiveOrganizationRoleProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, setState] = useState<ActiveOrganizationRoleState>(PENDING);
  const publish = useMemo(() => setState, [setState]);

  return (
    <PublishActiveOrganizationRoleContext.Provider value={publish}>
      <ActiveOrganizationRoleContext.Provider value={state}>
        {children}
      </ActiveOrganizationRoleContext.Provider>
    </PublishActiveOrganizationRoleContext.Provider>
  );
}

export function useActiveOrganizationRole(): ActiveOrganizationRoleState {
  return useContext(ActiveOrganizationRoleContext);
}

/**
 * Publish the organization role while the caller is mounted, and reset to
 * pending on unmount so a stale role never outlives the workspace.
 *
 * `resolved` must be true once the workspace has finished loading, including
 * the paths where it settles on no role at all — an empty workspace or a failed
 * detail fetch — otherwise the sidebar keeps waiting for a role that will never
 * arrive. Passed as separate primitives so the effect is not re-run by a fresh
 * object identity on every render.
 */
export function usePublishActiveOrganizationRole(
  role: OrganizationRole | undefined,
  resolved: boolean,
) {
  const publish = useContext(PublishActiveOrganizationRoleContext);

  useEffect(() => {
    if (!publish) {
      return;
    }

    publish(resolved ? { status: "resolved", role } : PENDING);

    return () => publish(PENDING);
  }, [publish, role, resolved]);
}
