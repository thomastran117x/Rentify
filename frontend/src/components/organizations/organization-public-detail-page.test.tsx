import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationPublicDetailPage } from "./organization-public-detail-page";

const getMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/organizations/api", () => ({
  organizationsApi: { getPublicById: getMock },
}));
vi.mock("@/lib/api/user-messages", () => ({
  getApiErrorMessage: () => "Organization API unavailable",
}));
vi.mock("@/lib/organizations/urls", () => ({
  organizationHref: (...parts: string[]) => `/organizations/${parts.join("/")}`,
}));
vi.mock("@/components/organizations/organization-public-visuals", () => ({
  OrganizationLogo: () => <div>Logo</div>,
  formatOrganizationDate: () => "Today",
  getWebsiteHost: () => "studio.example",
}));
vi.mock("@/components/organizations/organization-reviews-section", () => ({
  OrganizationReviewsSection: ({
    organizationId,
  }: {
    organizationId: string;
  }) => <div>Reviews {organizationId}</div>,
}));

const detail = {
  organization: {
    id: "org-1",
    slug: "studio",
    name: "Studio Co",
    description: "Rental experts",
    websiteUrl: "https://studio.example",
    addressLine1: "1 Main St",
    city: "Toronto",
    region: "ON",
    country: "Canada",
    createdAt: "2026-01-01",
    customFields: { Specialty: "Cameras" },
  },
  stats: { publishedPostingCount: 1 },
};

describe("OrganizationPublicDetailPage", () => {
  afterEach(() => vi.clearAllMocks());
  it("renders a public profile with its public links and details", async () => {
    getMock.mockResolvedValue(detail);
    render(<OrganizationPublicDetailPage id="org-1" />);
    expect(await screen.findByText("Studio Co")).toBeInTheDocument();
    expect(
      screen.getAllByText("1 Main St, Toronto, ON, Canada"),
    ).not.toHaveLength(0);
    expect(screen.getByText("Cameras")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View all postings/ }),
    ).toHaveAttribute(
      "href",
      "/postings?organizationId=org-1&sort=newest&page=1&pageSize=20",
    );
    expect(screen.getByText("Reviews org-1")).toBeInTheDocument();
  });
  it("renders the unavailable state after an API failure", async () => {
    getMock.mockRejectedValue(new Error("offline"));
    render(<OrganizationPublicDetailPage id="org-1" />);
    expect(
      await screen.findByText("Organization unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Organization API unavailable"),
    ).toBeInTheDocument();
  });
});
