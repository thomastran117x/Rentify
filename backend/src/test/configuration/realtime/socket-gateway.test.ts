import type { Server as SocketIoServer } from "socket.io";
import {
  closeGateway,
  GatewayWork,
} from "@/configuration/realtime/socket-gateway";

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("GatewayWork", () => {
  it("logs a failure instead of throwing it", async () => {
    const logger = { error: jest.fn() };
    const work = new GatewayWork(logger, "Socket work failed.");
    const failure = new Error("redis timed out");

    work.track(Promise.reject(failure));
    await work.drain();

    expect(logger.error).toHaveBeenCalledWith(
      "Socket work failed.",
      undefined,
      failure,
    );
  });

  it("waits for work still in flight, and forgets it once settled", async () => {
    const work = new GatewayWork({ error: jest.fn() }, "failed");
    let finish: () => void = () => {};
    let finished = false;
    work.track(
      new Promise<void>((resolve) => {
        finish = resolve;
      }).then(() => {
        finished = true;
      }),
    );

    const drained = work.drain();
    await flush();
    expect(finished).toBe(false);

    finish();
    await drained;
    expect(finished).toBe(true);
    await expect(work.drain()).resolves.toBeUndefined();
  });
});

describe("closeGateway", () => {
  function fakeServer(order: string[]) {
    return {
      local: {
        disconnectSockets: jest.fn(() => order.push("disconnect local")),
      },
      engine: { close: jest.fn(() => order.push("close engine")) },
      close: jest.fn(),
    };
  }

  it("disconnects this instance's sockets, drains their work, closes the engine, then quits Redis", async () => {
    const order: string[] = [];
    const io = fakeServer(order);
    const work = new GatewayWork({ error: jest.fn() }, "failed");
    work.track(
      Promise.resolve().then(() => {
        order.push("work settled");
      }),
    );
    const client = {
      quit: jest.fn(async () => {
        order.push("quit redis");
      }),
    };

    await closeGateway(io as unknown as SocketIoServer, work, [client]);

    expect(order).toEqual([
      "disconnect local",
      "work settled",
      "close engine",
      "quit redis",
    ]);
    expect(io.local.disconnectSockets).toHaveBeenCalledWith(true);
    // Never io.close(): the HTTP server is already closed by then.
    expect(io.close).not.toHaveBeenCalled();
  });

  it("still quits Redis when the server never attached, and when a quit fails", async () => {
    const work = new GatewayWork({ error: jest.fn() }, "failed");
    const failing = {
      quit: jest.fn(async () => Promise.reject(new Error("gone"))),
    };
    const healthy = { quit: jest.fn(async () => "OK") };

    await expect(
      closeGateway(null, work, [failing, healthy]),
    ).resolves.toBeUndefined();
    expect(failing.quit).toHaveBeenCalled();
    expect(healthy.quit).toHaveBeenCalled();
  });
});
