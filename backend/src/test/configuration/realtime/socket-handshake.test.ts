import {
  createSocketRedisAdapter,
  readCookie,
} from "@/configuration/realtime/socket-handshake";

const mockGetRedisClient = jest.fn();
const mockCreateAdapter = jest.fn(
  (_publisher: unknown, _subscriber: unknown, _options: unknown) => "adapter",
);

jest.mock("@/configuration/resources/redis", () => ({
  getRedisClient: () => mockGetRedisClient(),
}));
jest.mock("@socket.io/redis-adapter", () => ({
  createAdapter: (publisher: unknown, subscriber: unknown, options: unknown) =>
    mockCreateAdapter(publisher, subscriber, options),
}));

function fakeRedisClient(connect: () => Promise<void> = async () => {}) {
  const client = {
    connect: jest.fn(connect),
    quit: jest.fn(async () => undefined),
    duplicate: jest.fn(),
  };
  return client;
}

describe("readCookie", () => {
  it("reads the named cookie, decoded", () => {
    expect(
      readCookie("theme=dark; media_socket=a%2Bb%3D;  other=1", "media_socket"),
    ).toBe("a+b=");
  });

  it("is empty when the header or the cookie is missing", () => {
    expect(readCookie(undefined, "media_socket")).toBe("");
    expect(readCookie("", "media_socket")).toBe("");
    expect(readCookie("flag; theme=dark", "media_socket")).toBe("");
    expect(readCookie("media_socket_old=1", "media_socket")).toBe("");
  });
});

describe("createSocketRedisAdapter", () => {
  const logger = { error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds the adapter on its own pair of connections, under the given key", async () => {
    const publisher = fakeRedisClient();
    const subscriber = fakeRedisClient();
    publisher.duplicate.mockReturnValue(subscriber);
    mockGetRedisClient.mockReturnValue({ duplicate: () => publisher });

    const result = await createSocketRedisAdapter(logger, { key: "media" });

    expect(result).toEqual({
      adapter: "adapter",
      clients: [publisher, subscriber],
    });
    expect(publisher.connect).toHaveBeenCalled();
    expect(subscriber.connect).toHaveBeenCalled();
    expect(mockCreateAdapter).toHaveBeenCalledWith(publisher, subscriber, {
      key: "media",
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("keeps the default key when none is given", async () => {
    const publisher = fakeRedisClient();
    publisher.duplicate.mockReturnValue(fakeRedisClient());
    mockGetRedisClient.mockReturnValue({ duplicate: () => publisher });

    await createSocketRedisAdapter(logger);

    expect(mockCreateAdapter.mock.calls[0]?.[2]).toEqual({});
  });

  it("returns every opened connection for closing when one fails to connect", async () => {
    const publisher = fakeRedisClient();
    const subscriber = fakeRedisClient(async () => {
      throw new Error("connection refused");
    });
    publisher.duplicate.mockReturnValue(subscriber);
    mockGetRedisClient.mockReturnValue({ duplicate: () => publisher });

    const result = await createSocketRedisAdapter(logger);

    expect(result).toEqual({ adapter: null, clients: [publisher, subscriber] });
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to build the Redis adapter; realtime delivery is limited to this instance.",
      undefined,
      expect.any(Error),
    );
  });

  it("serves without an adapter when Redis is not connected", async () => {
    mockGetRedisClient.mockImplementation(() => {
      throw new Error("Redis is not connected.");
    });

    await expect(createSocketRedisAdapter(logger)).resolves.toEqual({
      adapter: null,
      clients: [],
    });
    expect(logger.error).toHaveBeenCalled();
  });
});
