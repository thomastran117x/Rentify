import { describe, expect, it, vi } from "vitest";

const { ioMock } = vi.hoisted(() => ({ ioMock: vi.fn(() => "socket") }));

vi.mock("socket.io-client", () => ({ io: ioMock }));
vi.mock("@/lib/env", () => ({
  resolveApiBaseUrl: () => "https://api.example.test/api/v1",
}));

const {
  MAX_CONSECUTIVE_SOCKET_FAILURES,
  openTicketedSocket,
  resolveSocketOrigin,
  socketRetryDelayMs,
  ticketedSocketOptions,
} = await import("./ticketed-socket");

describe("ticketed sockets", () => {
  it("connect to the API's origin, not its versioned path", () => {
    expect(resolveSocketOrigin()).toBe("https://api.example.test");
  });

  it("open with credentials, no automatic reconnection, and a Manager of their own", () => {
    expect(ticketedSocketOptions("/ws/media")).toEqual({
      path: "/ws/media",
      withCredentials: true,
      reconnection: false,
      forceNew: true,
    });
  });

  it("open on the given path with those options", () => {
    expect(openTicketedSocket("/ws/booking-messages")).toBe("socket");
    expect(ioMock).toHaveBeenCalledWith("https://api.example.test", {
      path: "/ws/booking-messages",
      withCredentials: true,
      reconnection: false,
      forceNew: true,
    });
  });

  it("space retries further apart after each failure, and give up after five", () => {
    expect([1, 2, 3, 4].map(socketRetryDelayMs)).toEqual([
      1_000, 2_000, 3_000, 4_000,
    ]);
    expect(MAX_CONSECUTIVE_SOCKET_FAILURES).toBe(5);
  });
});
