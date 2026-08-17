import { UsernameBloomStore } from "@/features/auth/username-bloom/username-bloom.store";

function createClient(overrides: Record<string, unknown> = {}) {
  const binaryClient = {
    get: jest.fn(async () => Buffer.from([0x81, 0xff])),
  };

  return {
    withTypeMapping: jest.fn(() => binaryClient),
    get: jest.fn(async () => null),
    set: jest.fn(async () => "OK"),
    bitField: jest.fn(async () => []),
    publish: jest.fn(async () => 1),
    rPush: jest.fn(async () => 1),
    lRange: jest.fn(async () => []),
    rename: jest.fn(async () => "OK"),
    exists: jest.fn(async () => 0),
    del: jest.fn(async () => 1),
    duplicate: jest.fn(),
    binaryClient,
    ...overrides,
  };
}

describe("UsernameBloomStore", () => {
  describe("readBitmap", () => {
    it("reads through a Buffer type mapping rather than as text", () => {
      // `client.get` decodes as UTF-8, which rewrites any byte above 0x7f — a
      // bitmap byte of 0x81 comes back as 0xfd. Those flipped bits would turn
      // "definitely absent" into a wrong answer.
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      return store.readBitmap("bits").then((bitmap) => {
        expect(client.withTypeMapping).toHaveBeenCalled();
        expect(client.get).not.toHaveBeenCalled();
        expect(bitmap).toEqual(Buffer.from([0x81, 0xff]));
      });
    });

    it("returns null when the bitmap key is missing", async () => {
      const client = createClient();
      client.binaryClient.get.mockResolvedValueOnce(null as never);
      const store = new UsernameBloomStore(() => client as never);

      await expect(store.readBitmap("bits")).resolves.toBeNull();
    });

    it("builds the binary client once per connection", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await store.readBitmap("bits");
      await store.readBitmap("bits");

      expect(client.withTypeMapping).toHaveBeenCalledTimes(1);
    });

    it("rebuilds the binary client after a reconnect hands back a new client", async () => {
      const first = createClient();
      const second = createClient();
      let current = first;
      const store = new UsernameBloomStore(() => current as never);

      await store.readBitmap("bits");
      current = second;
      await store.readBitmap("bits");

      expect(second.withTypeMapping).toHaveBeenCalledTimes(1);
    });
  });

  describe("setBits", () => {
    it("sets each offset to one", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await store.setBits("bits", [3, 9]);

      expect(client.bitField).toHaveBeenCalledWith("bits", [
        { operation: "SET", encoding: "u1", offset: 3, value: 1 },
        { operation: "SET", encoding: "u1", offset: 9, value: 1 },
      ]);
    });

    it("splits a large batch across commands", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await store.setBits(
        "bits",
        Array.from({ length: 1_100 }, (_, index) => index),
      );

      expect(client.bitField).toHaveBeenCalledTimes(3);
    });

    it("does nothing for an empty list", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await store.setBits("bits", []);

      expect(client.bitField).not.toHaveBeenCalled();
    });
  });

  describe("metadata", () => {
    it("round-trips through JSON", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);
      const meta = {
        generation: 2,
        builtAt: "2026-08-17T00:00:00.000Z",
        usernameCount: 5,
        estimatedFalsePositiveRate: 0.01,
      };

      await store.writeMeta("meta", meta);
      expect(client.set).toHaveBeenCalledWith("meta", JSON.stringify(meta));

      client.get.mockResolvedValueOnce(JSON.stringify(meta) as never);
      await expect(store.readMeta("meta")).resolves.toEqual(meta);
    });

    it("returns null for a missing key", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await expect(store.readMeta("meta")).resolves.toBeNull();
    });

    it("returns null rather than throwing on corrupt metadata", async () => {
      const client = createClient();
      client.get.mockResolvedValueOnce("{not json" as never);
      const store = new UsernameBloomStore(() => client as never);

      await expect(store.readMeta("meta")).resolves.toBeNull();
    });
  });

  describe("subscribe", () => {
    function createSubscriber() {
      return {
        on: jest.fn(),
        connect: jest.fn(async () => undefined),
        subscribe: jest.fn(
          async (
            _channel: string,
            _listener: (message: string) => void,
          ): Promise<void> => undefined,
        ),
        unsubscribe: jest.fn(async () => undefined),
        quit: jest.fn(async () => undefined),
        isOpen: true,
      };
    }

    function readMessageHandler(
      subscriber: ReturnType<typeof createSubscriber>,
    ): (message: string) => void {
      return subscriber.subscribe.mock.calls[0]![1];
    }

    it("uses a duplicated connection", async () => {
      // node-redis rejects ordinary commands on a subscribed client, so the
      // filter cannot share the connection it reads and writes with.
      const subscriber = createSubscriber();
      const client = createClient({ duplicate: jest.fn(() => subscriber) });
      const store = new UsernameBloomStore(() => client as never);

      await store.subscribe("channel", jest.fn());

      expect(client.duplicate).toHaveBeenCalled();
      expect(subscriber.connect).toHaveBeenCalled();
      expect(subscriber.subscribe).toHaveBeenCalledWith(
        "channel",
        expect.any(Function),
      );
    });

    it("delivers well-formed events", async () => {
      const subscriber = createSubscriber();
      const client = createClient({ duplicate: jest.fn(() => subscriber) });
      const store = new UsernameBloomStore(() => client as never);
      const onEvent = jest.fn();

      await store.subscribe("channel", onEvent);
      const handler = readMessageHandler(subscriber);

      handler(JSON.stringify({ type: "add", usernames: ["casey-doe"] }));

      expect(onEvent).toHaveBeenCalledWith({
        type: "add",
        usernames: ["casey-doe"],
      });
    });

    it("drops messages that are not recognizable events", async () => {
      const subscriber = createSubscriber();
      const client = createClient({ duplicate: jest.fn(() => subscriber) });
      const store = new UsernameBloomStore(() => client as never);
      const onEvent = jest.fn();
      const onError = jest.fn();

      await store.subscribe("channel", onEvent, onError);
      const handler = readMessageHandler(subscriber);

      handler(JSON.stringify({ type: "nonsense" }));
      handler(JSON.stringify({ type: "add", usernames: [42] }));
      handler("{not json");

      expect(onEvent).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it("reports connection errors through the error callback", async () => {
      const subscriber = createSubscriber();
      const client = createClient({ duplicate: jest.fn(() => subscriber) });
      const store = new UsernameBloomStore(() => client as never);
      const onError = jest.fn();

      await store.subscribe("channel", jest.fn(), onError);
      const errorHandler = subscriber.on.mock.calls[0]![1] as (
        error: unknown,
      ) => void;
      errorHandler(new Error("connection reset"));

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("unsubscribes and closes on shutdown", async () => {
      const subscriber = createSubscriber();
      const client = createClient({ duplicate: jest.fn(() => subscriber) });
      const store = new UsernameBloomStore(() => client as never);

      const subscription = await store.subscribe("channel", jest.fn());
      await subscription.close();

      expect(subscriber.unsubscribe).toHaveBeenCalledWith("channel");
      expect(subscriber.quit).toHaveBeenCalled();
    });

    it("skips teardown for an already-closed connection", async () => {
      const subscriber = createSubscriber();
      subscriber.isOpen = false;
      const client = createClient({ duplicate: jest.fn(() => subscriber) });
      const store = new UsernameBloomStore(() => client as never);

      const subscription = await store.subscribe("channel", jest.fn());
      await subscription.close();

      expect(subscriber.quit).not.toHaveBeenCalled();
    });

    it("swallows a failure to close", async () => {
      const subscriber = createSubscriber();
      subscriber.unsubscribe.mockRejectedValueOnce(new Error("already gone"));
      const client = createClient({ duplicate: jest.fn(() => subscriber) });
      const store = new UsernameBloomStore(() => client as never);
      const onError = jest.fn();

      const subscription = await store.subscribe("channel", jest.fn(), onError);

      await expect(subscription.close()).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalled();
    });
  });

  describe("plain key operations", () => {
    it("pushes and reads replay entries", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await store.pushReplayEntries("replay", ["casey-doe"]);
      expect(client.rPush).toHaveBeenCalledWith("replay", ["casey-doe"]);

      await store.readReplayEntries("replay");
      expect(client.lRange).toHaveBeenCalledWith("replay", 0, -1);
    });

    it("skips an empty replay push", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await store.pushReplayEntries("replay", []);

      expect(client.rPush).not.toHaveBeenCalled();
    });

    it("renames, checks existence, and deletes", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await store.rename("from", "to");
      expect(client.rename).toHaveBeenCalledWith("from", "to");

      client.exists.mockResolvedValueOnce(1 as never);
      await expect(store.exists("key")).resolves.toBe(true);
      await expect(store.exists("key")).resolves.toBe(false);

      await store.delete(["a", "b"]);
      expect(client.del).toHaveBeenCalledWith(["a", "b"]);
    });

    it("skips an empty delete", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await store.delete([]);

      expect(client.del).not.toHaveBeenCalled();
    });

    it("reads and writes plain keys", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await store.writeKey("pointer", "3");
      expect(client.set).toHaveBeenCalledWith("pointer", "3");

      await store.readKey("pointer");
      expect(client.get).toHaveBeenCalledWith("pointer");
    });

    it("writes a bitmap as raw bytes", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);
      const bitmap = Buffer.from([0x81, 0xff]);

      await store.writeBitmap("bits", bitmap);

      expect(client.set).toHaveBeenCalledWith("bits", bitmap);
    });

    it("publishes an event as JSON", async () => {
      const client = createClient();
      const store = new UsernameBloomStore(() => client as never);

      await store.publish("channel", { type: "rebuilt", generation: 4 });

      expect(client.publish).toHaveBeenCalledWith(
        "channel",
        JSON.stringify({ type: "rebuilt", generation: 4 }),
      );
    });
  });
});
