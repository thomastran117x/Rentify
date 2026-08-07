import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookingRequestsApi } from "./api";

const { requestMock, pathMock } = vi.hoisted(() => ({ requestMock: vi.fn(), pathMock: vi.fn((path: string, query: Record<string, unknown>) => `${path}?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()}`) }));
vi.mock("@/lib/api/client", () => ({ authenticatedJson: requestMock, buildPathWithQuery: pathMock }));

describe("bookingRequestsApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates quotes and requests with encoded posting ids", () => {
    const request = { startAt: "2026-08-01", endAt: "2026-08-03", contactName: "Alex", contactEmail: "alex@example.com" };
    bookingRequestsApi.create("post / 1", request);
    bookingRequestsApi.quote("post / 1", { startAt: "2026-08-01", endAt: "2026-08-03" });
    expect(requestMock).toHaveBeenCalledWith("POST", "/postings/post%20%2F%201/booking-requests", request);
    expect(requestMock).toHaveBeenCalledWith("POST", "/postings/post%20%2F%201/booking-quote", { startAt: "2026-08-01", endAt: "2026-08-03" });
  });

  it("uses pagination defaults and filters for list and dashboard routes", () => {
    bookingRequestsApi.listForPosting("post"); bookingRequestsApi.listMine({ page: 2, status: "approved" }); bookingRequestsApi.listOwned();
    bookingRequestsApi.getRenterDashboard({ pageSize: 50, sort: "startAtAsc", bucket: "upcoming" });
    bookingRequestsApi.getOwnerDashboard({ status: "pending", actionNeeded: "needs_decision", postingId: "post-1" });
    expect(requestMock).toHaveBeenCalledWith("GET", "/postings/post/booking-requests?page=1&pageSize=20");
    expect(requestMock).toHaveBeenCalledWith("GET", "/booking-requests/me?page=2&pageSize=20&status=approved");
    expect(requestMock).toHaveBeenCalledWith("GET", "/booking-requests/owner?page=1&pageSize=20");
    expect(requestMock).toHaveBeenCalledWith("GET", "/booking-requests/me/dashboard?page=1&pageSize=50&sort=startAtAsc&bucket=upcoming");
    expect(requestMock).toHaveBeenCalledWith("GET", "/booking-requests/owner/dashboard?page=1&pageSize=20&status=pending&actionNeeded=needs_decision&postingId=post-1");
  });

  it("gets, updates, decides, quotes cancellation, and cancels a booking", () => {
    const update = { startAt: "2026-08-04", endAt: "2026-08-05", contactName: "Alex", contactEmail: "alex@example.com" };
    bookingRequestsApi.getById("request / 1"); bookingRequestsApi.update("request / 1", update); bookingRequestsApi.getCancellationQuote("request / 1"); bookingRequestsApi.approve("request / 1"); bookingRequestsApi.decline("request / 1", { note: "No" }); bookingRequestsApi.cancel("request / 1", { reason: "Changed plans" });
    expect(requestMock).toHaveBeenCalledWith("GET", "/booking-requests/request%20%2F%201");
    expect(requestMock).toHaveBeenCalledWith("PATCH", "/booking-requests/request%20%2F%201", update);
    expect(requestMock).toHaveBeenCalledWith("GET", "/booking-requests/request%20%2F%201/cancellation-quote");
    expect(requestMock).toHaveBeenCalledWith("POST", "/booking-requests/request%20%2F%201/approve", {});
    expect(requestMock).toHaveBeenCalledWith("POST", "/booking-requests/request%20%2F%201/decline", { note: "No" });
    expect(requestMock).toHaveBeenCalledWith("POST", "/booking-requests/request%20%2F%201/cancel", { reason: "Changed plans" });
  });
});
