import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnerDashboard } from "./owner-dashboard";

const { authMock, routerMock, canReadMock, summaryMock, listMock, detailMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  routerMock: { replace: vi.fn() },
  canReadMock: vi.fn(),
  summaryMock: vi.fn(),
  listMock: vi.fn(),
  detailMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
vi.mock("@/components/auth/auth-context", () => ({ useAuth: authMock }));
vi.mock("@/lib/auth/roles", () => ({ canReadOrganizationPostings: canReadMock }));
vi.mock("@/lib/api/user-messages", () => ({ getApiErrorMessage: () => "Load failed" }));
vi.mock("@/lib/postings/analytics", () => ({
  postingsAnalyticsApi: { getOwnerSummary: summaryMock, listOwnerPostings: listMock, getPostingDetail: detailMock },
}));
vi.mock("@/components/common/pagination", () => ({ Pagination: () => <div>Pagination</div> }));
vi.mock("./analytics-ui", () => ({
  DASHBOARD_POLL_INTERVAL_MS: 60_000,
  LoadingDashboard: () => <div>Loading analytics</div>, RestrictedState: () => <div>Restricted</div>,
  ErrorState: ({ title, description }: { title: string; description: string }) => <div>{title}: {description}</div>,
  EmptyAnalyticsState: ({ title }: { title: string }) => <div>{title}</div>,
  AnalyticsCard: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2>{title}</h2>{children}</section>,
  StatCard: ({ eyebrow }: { eyebrow: string }) => <div>{eyebrow}</div>, WindowSwitcher: () => <div>Window</div>, FreshnessBadge: () => <div>Fresh</div>,
  MetricSelect: () => <div>Metric</div>, GranularitySelect: () => <div>Granularity</div>, TrendChart: () => <div>Trend</div>, FunnelCard: () => <div>Funnel</div>,
  DiagnosticsList: () => <div>Diagnostics</div>, OutcomeBars: () => <div>Outcomes</div>,
  formatCompactNumber: (value: number) => String(value), formatMoney: (value: number) => `$${value}`, formatPercent: (value: number) => `${value}%`, formatStatus: (value: string) => value,
  buildDashboardDiagnostics: () => [],
}));

const totals = { searchImpressions: 20, searchClicks: 4, views: 12, bookingRequests: 2, confirmedBookings: 1, estimatedConfirmedRevenue: 100, refundedRevenue: 0 };
const derivedMetrics = { ctr: 20, viewToRequestRate: 10, requestToConfirmedRate: 50, utilizationRate: 25 };

describe("OwnerDashboard", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("shows loading and redirects anonymous visitors", () => {
    authMock.mockReturnValue({ status: "loading", session: null });
    const { rerender, unmount } = render(<OwnerDashboard />);
    expect(screen.getByText("Loading analytics")).toBeInTheDocument();

    authMock.mockReturnValue({ status: "anonymous", session: null });
    rerender(<OwnerDashboard />);
    expect(routerMock.replace).toHaveBeenCalledWith("/login");

    unmount();
  });

  it("loads owner analytics, selects the first posting, and renders the dashboard", async () => {
    canReadMock.mockReturnValue(true);
    authMock.mockReturnValue({ status: "authenticated", session: { user: { activeOrganization: { id: "org-1" } } } });
    summaryMock.mockResolvedValue({ totals, derivedMetrics });
    listMock.mockResolvedValue({ postings: [{ postingId: "posting-1", name: "Camera", status: "published", totals, derivedMetrics }], pagination: {} });
    detailMock.mockResolvedValue({ buckets: [] });

    render(<OwnerDashboard />);
    await waitFor(() => expect(screen.getByText("Posting performance")).toBeInTheDocument());
    expect(summaryMock).toHaveBeenCalledWith("7d");
    await waitFor(() =>
      expect(detailMock).toHaveBeenCalledWith("posting-1", {
        window: "7d",
        granularity: "day",
      }),
    );
    expect(screen.getAllByText("Camera")).not.toHaveLength(0);
  });
});
