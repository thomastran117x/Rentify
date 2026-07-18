import type { Metadata } from "next";
import type { ReactNode } from "react";
import { OrganizationWorkspaceProvider } from "@/components/organizations/workspace/workspace-provider";
import { WorkspaceChrome } from "@/components/organizations/workspace/workspace-chrome";

export const metadata: Metadata = {
  title: "Organization Workspace | Rentify",
  description:
    "Manage organization memberships, pending invites, and your active workspace context on Rentify.",
};

export default function OrganizationWorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <OrganizationWorkspaceProvider>
      <WorkspaceChrome>{children}</WorkspaceChrome>
    </OrganizationWorkspaceProvider>
  );
}
