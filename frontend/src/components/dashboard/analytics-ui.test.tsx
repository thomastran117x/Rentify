import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  DiagnosticsList,
  EmptyAnalyticsState,
  ErrorState,
  FreshnessBadge,
  MiniSparkline,
  RestrictedState,
  TrendChart,
  buildDashboardDiagnostics,
  formatBucketLabel,
  formatCompactNumber,
  formatMetricLabel,
  formatMetricValue,
  formatPercent,
  formatStatus,
  formatTimestamp,
  WindowSwitcher,
} from "./analytics-ui";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("analytics UI helpers", () => {
  const bucket = {
    bucketStart: "2026-05-24T10:00:00.000Z",
    bucketEnd: "2026-05-24T11:00:00.000Z",
    granularity: "hour" as const,
    metrics: {
      searchImpressions: 20,
      searchClicks: 4,
      views: 5,
      uniqueViews: 5,
      bookingRequests: 2,
      approvedRequests: 1,
      declinedRequests: 0,
      expiredRequests: 0,
      cancelledRequests: 0,
      paymentFailedRequests: 0,
      confirmedBookings: 1,
      estimatedConfirmedRevenue: 250,
      refundedRevenue: 0,
    },
    derivedMetrics: {
      ctr: 0.2,
      viewToRequestRate: 0.4,
      clickToRequestRate: 0.5,
      requestToApprovalRate: 0.5,
      requestToConfirmedRate: 0.5,
      utilizationRate: 0.2,
      averageRevenuePerConfirmedBooking: 250,
    },
  };

  it("formats analytics values for display", () => {
    expect(formatMetricLabel("searchImpressions")).toBe("Search Impressions");
    expect(formatCompactNumber(1234)).toBe("1K");
    expect(formatPercent(0.25)).toBe("25%");
    expect(formatTimestamp(undefined)).toBe("Not yet");
    expect(formatStatus("payment_failed")).toBe("Payment failed");
    expect(formatBucketLabel(bucket)).toBeTruthy();
    expect(formatMetricValue("estimatedConfirmedRevenue", 250)).toContain(
      "250",
    );
    expect(formatMetricValue("views", 1250)).toBe("1K");
  });

  it("builds diagnostics for common funnel issues", () => {
    const diagnostics = buildDashboardDiagnostics({
      searchImpressions: 30,
      searchClicks: 0,
      views: 15,
      uniqueViews: 10,
      bookingRequests: 0,
      approvedRequests: 0,
      declinedRequests: 0,
      expiredRequests: 0,
      cancelledRequests: 0,
      paymentFailedRequests: 0,
      confirmedBookings: 0,
      estimatedConfirmedRevenue: 0,
      refundedRevenue: 0,
      activeDaysPublished: 7,
      calendarBlockedDays: 0,
      confirmedBookedDays: 0,
    });

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.title).toContain("High exposure");
    expect(diagnostics[1]?.title).toContain("Views are not converting");
  });

  it("renders chart and fallback states", () => {
    const { rerender } = render(
      <TrendChart buckets={[bucket]} metricKey="views" />,
    );

    expect(document.querySelector("svg")).toBeTruthy();

    rerender(
      <MiniSparkline values={[]} accent="from-slate-950 to-slate-700" />,
    );
    expect(document.querySelector("svg")).toBeFalsy();
  });

  it("renders diagnostic and shell components", () => {
    render(
      <>
        <FreshnessBadge
          lastUpdatedAt="2026-05-24T10:00:00.000Z"
          refreshing={false}
        />
        <DiagnosticsList
          items={[
            {
              title: "Healthy funnel",
              detail: "Conversions are happening.",
              tone: "emerald",
            },
          ]}
        />
        <EmptyAnalyticsState
          title="No analytics yet"
          description="Data appears after traffic starts."
        />
        <ErrorState
          title="Analytics failed"
          description="Reload to try again."
          action={<button type="button">Retry</button>}
        />
        <RestrictedState />
      </>,
    );

    expect(screen.getByText(/Live/)).toBeInTheDocument();
    expect(screen.getByText("Healthy funnel")).toBeInTheDocument();
    expect(screen.getByText("No analytics yet")).toBeInTheDocument();
    expect(screen.getByText("Analytics failed")).toBeInTheDocument();
    expect(
      screen.getByText("Owner analytics unlock when you start hosting"),
    ).toBeInTheDocument();
  });

  it("renders the window switcher and updates through callbacks", async () => {
    const onChange = vi.fn();

    render(<WindowSwitcher value="7d" onChange={onChange} />);

    await screen.getByRole("button", { name: "30D" }).click();

    expect(onChange).toHaveBeenCalledWith("30d");
  });
});
