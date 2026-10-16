import { asUuid } from "@/configuration/validation/uuid";
import {
  NoopMediaStatusPublisher,
  RedisMediaStatusPublisher,
  type MediaStatusPublisher,
  type RedisPublishClient,
} from "@/features/media/media-status-publisher";
import { testUuid } from "../../support/uuid";

const USER_ID = asUuid(testUuid(9000, 994420));
const MEDIA_ID = asUuid(testUuid(9000, 994421));

function createPublisher(client: RedisPublishClient | null) {
  const logger = { warn: jest.fn() };
  const publisher = new RedisMediaStatusPublisher(() => client, logger);

  return { publisher, logger };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("RedisMediaStatusPublisher", () => {
  it("publishes the event on the gateway's channel for the user's room", async () => {
    const client = { publish: jest.fn(async () => 1) };
    const { publisher } = createPublisher(client);

    publisher.publish(USER_ID, { mediaId: MEDIA_ID, status: "ready" });

    expect(client.publish).toHaveBeenCalledTimes(1);
    const [channel, message] = client.publish.mock.calls[0] as unknown as [
      string,
      Buffer,
    ];
    // The adapter's key, the default namespace, then the room.
    expect(channel).toBe(`socket.io-media#/#media-status:${USER_ID}#`);
    // MessagePack keeps strings as their bytes, so the packet can be read
    // without decoding it.
    const encoded = message.toString("utf8");
    for (const part of [
      "media.status",
      MEDIA_ID,
      "ready",
      `media-status:${USER_ID}`,
    ]) {
      expect(encoded).toContain(part);
    }
  });

  it("drops the push while Redis is not ready", () => {
    const { publisher, logger } = createPublisher(null);

    expect(() =>
      publisher.publish(USER_ID, { mediaId: MEDIA_ID, status: "ready" }),
    ).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs, and never rejects, when Redis refuses the publish", async () => {
    const client = {
      publish: jest.fn(async () => {
        throw new Error("connection lost");
      }),
    };
    const { publisher, logger } = createPublisher(client);

    publisher.publish(USER_ID, { mediaId: MEDIA_ID, status: "rejected" });
    await flush();

    expect(logger.warn).toHaveBeenCalledWith("Failed to push a media status.", {
      error: "connection lost",
    });
  });

  it("logs, and never throws, when publishing fails at once", () => {
    const client = {
      publish: jest.fn(() => {
        throw new Error("client closed");
      }),
    };
    const { publisher, logger } = createPublisher(client);

    expect(() =>
      publisher.publish(USER_ID, { mediaId: MEDIA_ID, status: "ready" }),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith("Failed to push a media status.", {
      mediaId: MEDIA_ID,
      error: "client closed",
    });
  });

  it("reads the shared client by default, and pushes nothing without one", () => {
    expect(() =>
      new RedisMediaStatusPublisher().publish(USER_ID, {
        mediaId: MEDIA_ID,
        status: "ready",
      }),
    ).not.toThrow();
  });
});

describe("NoopMediaStatusPublisher", () => {
  it("does nothing", () => {
    const publisher: MediaStatusPublisher = new NoopMediaStatusPublisher();

    expect(() =>
      publisher.publish(USER_ID, {
        mediaId: MEDIA_ID,
        status: "ready",
      }),
    ).not.toThrow();
  });
});
