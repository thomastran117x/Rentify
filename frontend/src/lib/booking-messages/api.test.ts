import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestMock, pathMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  pathMock: vi.fn(
    (path: string, params: Record<string, unknown>) =>
      `${path}?${new URLSearchParams(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ).toString()}`,
  ),
}));

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: requestMock,
  buildPathWithQuery: pathMock,
}));

const { bookingMessagesApi } = await import("@/lib/booking-messages/api");

describe("bookingMessagesApi", () => {
  beforeEach(() => {
    requestMock.mockReset();
    pathMock.mockClear();
  });

  it("lists a thread with pagination defaults", () => {
    bookingMessagesApi.list("booking-1");

    expect(pathMock).toHaveBeenCalledWith(
      "/booking-requests/booking-1/messages",
      { page: 1, pageSize: 20 },
    );
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/booking-requests/booking-1/messages?page=1&pageSize=20",
    );
  });

  it("passes explicit pagination through", () => {
    bookingMessagesApi.list("booking-1", { page: 3, pageSize: 5 });

    expect(pathMock).toHaveBeenCalledWith(
      "/booking-requests/booking-1/messages",
      { page: 3, pageSize: 5 },
    );
  });

  it("sends a message", () => {
    bookingMessagesApi.send("booking-1", { body: "Hello" });

    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/booking-requests/booking-1/messages",
      { body: "Hello" },
    );
  });

  it("marks a thread read", () => {
    bookingMessagesApi.markRead("booking-1");

    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/booking-requests/booking-1/messages/read",
    );
  });

  it("encodes booking identifiers", () => {
    bookingMessagesApi.send("book ing/1", { body: "Hello" });

    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/booking-requests/book%20ing%2F1/messages",
      { body: "Hello" },
    );
  });
});
