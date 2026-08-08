import { beforeEach, describe, expect, it, vi } from "vitest";
import { rentingsApi } from "./api";

const { requestMock, pathMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  pathMock: vi.fn(
    (path: string, query: Record<string, unknown>) =>
      `${path}?${new URLSearchParams(
        Object.entries(query)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)]),
      ).toString()}`,
  ),
}));
vi.mock("@/lib/api/client", () => ({
  authenticatedJson: requestMock,
  buildPathWithQuery: pathMock,
}));

describe("rentingsApi", () => {
  beforeEach(() => vi.clearAllMocks());
  it("converts and lists rentings with defaults and filters", () => {
    rentingsApi.convertBookingRequest("booking / 1");
    rentingsApi.listMine();
    rentingsApi.listMine({ page: 2, pageSize: 50, status: "active" });
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/booking-requests/booking%20%2F%201/convert",
      {},
    );
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/rentings/me?page=1&pageSize=20",
    );
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/rentings/me?page=2&pageSize=50&status=active",
    );
  });
  it("gets and transitions a renting and manages disputes", () => {
    const id = "renting / 1";
    rentingsApi.getById(id);
    rentingsApi.updateInstructions(id, {
      pickupInstructions: "Pick up",
      returnInstructions: "Return",
    });
    rentingsApi.markCheckInReady(id);
    rentingsApi.markCheckInComplete(id);
    rentingsApi.markReturnComplete(id);
    rentingsApi.createDispute(id, { reason: "Damaged", details: "Scratch" });
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/rentings/renting%20%2F%201",
    );
    expect(requestMock).toHaveBeenCalledWith(
      "PUT",
      "/rentings/renting%20%2F%201/instructions",
      expect.objectContaining({ pickupInstructions: "Pick up" }),
    );
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/rentings/renting%20%2F%201/check-in-ready",
      {},
    );
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/rentings/renting%20%2F%201/disputes",
      { reason: "Damaged", details: "Scratch" },
    );
  });
});
