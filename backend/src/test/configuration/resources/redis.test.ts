const mockCreateClient = jest.fn();
const mockGetRedisConfig = jest.fn(() => ({
  url: "redis://cache.test:6379",
  host: "cache.test",
  port: 6379,
  password: "",
  db: 2,
  connectTimeoutMs: 1500,
}));
const mockLoggerError = jest.fn();

jest.mock("redis", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

jest.mock("@/configuration/environment", () => ({
  environment: {
    getRedisConfig: (...args: unknown[]) => mockGetRedisConfig(...args),
  },
}));

jest.mock("@/configuration/logging", () => ({
  loggerFactory: {
    forComponent: () => ({
      error: (...args: unknown[]) => mockLoggerError(...args),
    }),
  },
}));

function createMockRedisClient(initiallyOpen = false) {
  const eventHandlers = new Map<string, (...args: unknown[]) => void>();
  const client = {
    isOpen: initiallyOpen,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      eventHandlers.set(event, handler);
    }),
    connect: jest.fn(async () => {
      client.isOpen = true;
    }),
    quit: jest.fn(async () => {
      client.isOpen = false;
    }),
  };

  return {
    client,
    emit: (event: string, ...args: unknown[]) => {
      eventHandlers.get(event)?.(...args);
    },
  };
}

async function loadRedisModule() {
  return import("@/configuration/resources/redis");
}

describe("redis resource", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockGetRedisConfig.mockReturnValue({
      url: "redis://cache.test:6379",
      host: "cache.test",
      port: 6379,
      password: "",
      db: 2,
      connectTimeoutMs: 1500,
    });
  });

  it("builds a client from the explicit redis URL and logs client errors", async () => {
    const redisClientMock = createMockRedisClient(false);
    mockCreateClient.mockReturnValue(redisClientMock.client);
    const redisModule = await loadRedisModule();

    const connected = await redisModule.connectRedis();

    expect(connected).toBe(redisClientMock.client);
    expect(mockCreateClient).toHaveBeenCalledWith({
      url: "redis://cache.test:6379",
      database: 2,
      socket: {
        connectTimeout: 1500,
      },
    });

    const error = new Error("cache down");
    redisClientMock.emit("error", error);

    expect(mockLoggerError).toHaveBeenCalledWith(
      "Redis client error.",
      undefined,
      error,
    );
  });

  it("builds password-based redis URLs and reuses an open client", async () => {
    mockGetRedisConfig.mockReturnValue({
      url: "",
      host: "redis.internal",
      port: 6380,
      password: "secret",
      db: 4,
      connectTimeoutMs: 900,
    });
    const redisClientMock = createMockRedisClient(false);
    mockCreateClient.mockReturnValue(redisClientMock.client);
    const redisModule = await loadRedisModule();

    const first = await redisModule.connectRedis();
    const second = await redisModule.connectRedis();

    expect(first).toBe(redisClientMock.client);
    expect(second).toBe(redisClientMock.client);
    expect(redisClientMock.client.connect).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledWith({
      url: "redis://:secret@redis.internal:6380",
      database: 4,
      socket: {
        connectTimeout: 900,
      },
    });
    expect(redisModule.redisClient).toBe(redisClientMock.client);
    expect(redisModule.getRedisClient()).toBe(redisClientMock.client);
  });

  it("throws when callers ask for a client before connect opens it", async () => {
    const redisModule = await loadRedisModule();

    expect(() => redisModule.getRedisClient()).toThrow(
      "Redis has not been initialized. Call connectRedis() first.",
    );
  });

  it("disconnects open clients and leaves closed clients alone", async () => {
    const redisClientMock = createMockRedisClient(false);
    mockCreateClient.mockReturnValue(redisClientMock.client);
    const redisModule = await loadRedisModule();

    await redisModule.disconnectRedis();
    expect(redisClientMock.client.quit).not.toHaveBeenCalled();

    await redisModule.connectRedis();
    await redisModule.disconnectRedis();
    await redisModule.disconnectRedis();

    expect(redisClientMock.client.quit).toHaveBeenCalledTimes(1);
    expect(() => redisModule.getRedisClient()).toThrow(
      "Redis has not been initialized. Call connectRedis() first.",
    );
  });
});
