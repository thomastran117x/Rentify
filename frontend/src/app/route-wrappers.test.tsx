import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "./forgot-password/page";
import OrganizationsPage from "./organizations/page";
import ModerationPage from "./moderation/page";
import BookingsPage from "./bookings/page";
import PostingCreatePage from "./postings/create/page";
import SavedPostingsPage from "./saved/page";
import RentingDetailPage from "./rentings/[id]/page";
import DashboardPostingDetailPage from "./dashboard/postings/[id]/page";
import OrganizationInviteRoute from "./organizations/invitations/[token]/page";

const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/components/organizations/organization-directory-page", () => ({
  OrganizationDirectoryPage: () => <div>Organization directory</div>,
}));
vi.mock("@/components/reports/moderation-workspace", () => ({
  ModerationWorkspace: () => <div>Moderation workspace</div>,
}));
vi.mock("@/components/bookings/bookings-dashboard", () => ({
  BookingsDashboard: () => <div>Bookings dashboard</div>,
}));
vi.mock("@/components/postings/posting-management-workspace", () => ({
  PostingManagementWorkspace: () => <div>Posting workspace</div>,
}));
vi.mock("@/components/postings/saved-postings-workspace", () => ({
  SavedPostingsWorkspace: () => <div>Saved postings</div>,
}));
vi.mock("@/components/rentings/renting-detail-client", () => ({
  RentingDetailClient: ({ rentingId }: { rentingId: string }) => <div>Renting {rentingId}</div>,
}));
vi.mock("@/components/dashboard/posting-dashboard-detail", () => ({
  PostingDashboardDetail: ({ postingId }: { postingId: string }) => <div>Posting {postingId}</div>,
}));
vi.mock("@/components/organizations/organization-invite-page", () => ({
  OrganizationInvitePage: ({ token }: { token: string }) => <div>Invite {token}</div>,
}));

describe("app route wrappers", () => {
  it("redirects the deprecated password route to account recovery", () => {
    ForgotPasswordPage();
    expect(redirectMock).toHaveBeenCalledWith("/login?recovery=account");
  });

  it.each([
    [OrganizationsPage, "Organization directory"],
    [ModerationPage, "Moderation workspace"],
    [BookingsPage, "Bookings dashboard"],
    [PostingCreatePage, "Posting workspace"],
    [SavedPostingsPage, "Saved postings"],
  ])("renders %s through its page wrapper", (Page, content) => {
    render(<Page />);
    expect(screen.getByText(content)).toBeInTheDocument();
  });

  it("passes dynamic route parameters to renting, posting, and invitation views", async () => {
    render(await RentingDetailPage({ params: Promise.resolve({ id: "renting-1" }) }));
    expect(screen.getByText("Renting renting-1")).toBeInTheDocument();

    render(await DashboardPostingDetailPage({ params: Promise.resolve({ id: "posting-1" }) }));
    expect(screen.getByText("Posting posting-1")).toBeInTheDocument();

    render(await OrganizationInviteRoute({ params: Promise.resolve({ token: "invite-token" }) }));
    expect(screen.getByText("Invite invite-token")).toBeInTheDocument();
  });
});
