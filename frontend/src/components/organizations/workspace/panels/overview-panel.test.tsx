import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverviewPanel } from "./overview-panel";
const { workspaceMock, pushMock } = vi.hoisted(() => ({
  workspaceMock: vi.fn(),
  pushMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/components/organizations/workspace/workspace-provider", () => ({
  useOrganizationWorkspace: workspaceMock,
}));
vi.mock("@/components/organizations/shared/primitives", () => ({
  SectionCard: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SurfaceNote: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  WorkspaceQuickActionCard: ({
    title,
    onClick,
  }: {
    title: string;
    onClick: () => void;
  }) => <button onClick={onClick}>{title}</button>,
}));
vi.mock("@/components/organizations/shared/badges", () => ({
  RoleBadge: ({ role }: { role: string }) => <span>{role}</span>,
}));
vi.mock("@/components/organizations/shared/format", () => ({
  formatDate: () => "Today",
}));
describe("OverviewPanel", () => {
  it("returns no panel until workspace detail is available", () => {
    workspaceMock.mockReturnValue({ detail: null });
    const { container } = render(<OverviewPanel />);
    expect(container).toBeEmptyDOMElement();
  });
  it("renders permitted quick actions and opens a workspace section", () => {
    workspaceMock.mockReturnValue({
      detail: {
        viewerRole: "manager",
        organization: {
          createdAt: "2026-01-01",
          description: "Details",
          websiteUrl: "https://studio.example",
          contactEmail: "person@example.com",
          contactPhone: "123",
          addressLine1: "1 Main",
          addressLine2: null,
          city: "Toronto",
          region: "ON",
          postalCode: "A1A",
          country: "Canada",
          customFields: { Specialty: "Cameras" },
        },
      },
      membershipCount: 2,
      memberCount: 3,
      inviteCount: 1,
      postingsTotal: 4,
      auditLogs: [{}],
      canInvite: true,
      canSeeActivity: true,
      canEditSettings: true,
    });
    render(<OverviewPanel />);
    expect(
      screen.getByText("Refresh organization details"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Manage teammates and invites" }),
    );
    expect(pushMock).toHaveBeenCalledWith("/dashboard/organizations/team");
    expect(screen.getByText("Cameras")).toBeInTheDocument();
  });
});
