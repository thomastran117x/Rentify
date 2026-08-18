import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostingDashboardDetail } from "./posting-dashboard-detail";
const { authMock, canReadMock, detailMock, exportMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  canReadMock: vi.fn(),
  detailMock: vi.fn(),
  exportMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/auth/auth-context", () => ({ useAuth: authMock }));
vi.mock("@/lib/auth/roles", () => ({
  canReadOrganizationPostings: canReadMock,
}));
vi.mock("@/lib/api/user-messages", () => ({
  getApiErrorMessage: () => "Analytics unavailable",
}));
vi.mock("@/lib/postings/analytics", () => ({
  postingsAnalyticsApi: { getPostingDetail: detailMock, exportCsv: exportMock },
}));
vi.mock("./analytics-ui", () => ({
  DASHBOARD_POLL_INTERVAL_MS: 60000,
  LoadingDashboard: () => <div>Loading</div>,
  RestrictedState: () => <div>Restricted</div>,
  ErrorState: ({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) => (
    <div>
      {title} {description}
    </div>
  ),
  EmptyAnalyticsState: ({ title }: { title: string }) => <div>{title}</div>,
  AnalyticsCard: ({
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
  WindowSwitcher: () => <div>Window</div>,
  FreshnessBadge: () => <div>Fresh</div>,
  MetricSelect: () => <div>Metric</div>,
  GranularitySelect: () => <div>Granularity</div>,
  TrendChart: () => <div>Trend</div>,
  DiagnosticsList: () => <div>Diagnostics</div>,
  OutcomeBars: () => <div>Outcomes</div>,
  formatCompactNumber: (v: number) => String(v),
  formatMoney: (v: number) => `$${v}`,
  formatPercent: (v: number) => `${v}%`,
  formatStatus: (v: string) => v,
  buildDashboardDiagnostics: () => [],
}));
const totals = {
  searchImpressions: 10,
  bookingRequests: 2,
  confirmedBookings: 1,
  estimatedConfirmedRevenue: 100,
  refundedRevenue: 0,
  confirmedBookedDays: 3,
};
const derivedMetrics = {
  ctr: 10,
  viewToRequestRate: 20,
  requestToApprovalRate: 30,
  requestToConfirmedRate: 40,
  averageRevenuePerConfirmedBooking: 100,
  utilizationRate: 50,
};
describe("PostingDashboardDetail", () => {
  afterEach(() => vi.clearAllMocks());
  it("loads a posting analytics request and renders its empty state", async () => {
    authMock.mockReturnValue({
      status: "authenticated",
      session: { user: { activeOrganization: {} } },
    });
    canReadMock.mockReturnValue(true);
    detailMock.mockResolvedValue(null);
    render(<PostingDashboardDetail postingId="posting-1" />);
    await waitFor(() =>
      expect(detailMock).toHaveBeenCalledWith("posting-1", {
        window: "7d",
        granularity: "day",
      }),
    );
    expect(
      screen.getByText("No analytics found for this posting"),
    ).toBeInTheDocument();
  });
  it("shows the restricted state immediately for a viewer who never had posting-read permission", () => {
    authMock.mockReturnValue({
      status: "authenticated",
      session: { user: {} },
    });
    canReadMock.mockReturnValue(false);
    render(<PostingDashboardDetail postingId="posting-1" />);
    expect(screen.getByText("Restricted")).toBeInTheDocument();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  });
  it("shows an API error after loading", async () => {
    authMock.mockReturnValue({
      status: "authenticated",
      session: { user: { activeOrganization: {} } },
    });
    canReadMock.mockReturnValue(true);
    detailMock.mockRejectedValue(new Error("offline"));
    render(<PostingDashboardDetail postingId="posting-1" />);
    expect(
      await screen.findByText(/Posting analytics could not be loaded/),
    ).toBeInTheDocument();
  });
});
