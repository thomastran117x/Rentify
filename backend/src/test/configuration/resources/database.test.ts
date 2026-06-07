const mockPrismaClient = jest.fn();
const mockGetDatabaseConfig = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: function PrismaClient(...args: unknown[]) {
    return mockPrismaClient(...args);
  },
}));

jest.mock("@/configuration/environment/index", () => ({
  environment: {
    getDatabaseConfig: (...args: unknown[]) => mockGetDatabaseConfig(...args),
  },
}));

jest.mock("@/configuration/logging", () => ({
  loggerFactory: {
    forComponent: () => ({
      info: (...args: unknown[]) => mockLoggerInfo(...args),
      warn: (...args: unknown[]) => mockLoggerWarn(...args),
    }),
  },
}));

function createMockDatabaseClient() {
  const queryHandlers: Array<
    (event: { duration: number; query: string; target: string }) => void
  > = [];

  return {
    client: {
      $connect: jest.fn(async () => undefined),
      $disconnect: jest.fn(async () => undefined),
      $on: jest.fn(
        (
          event: string,
          handler: (payload: {
            duration: number;
            query: string;
            target: string;
          }) => void,
        ) => {
          if (event === "query") {
            queryHandlers.push(handler);
          }
        },
      ),
      $queryRaw: jest.fn(async () => [{ "?column?": 1 }]),
    },
    emitQuery(event: { duration: number; query: string; target: string }) {
      queryHandlers.forEach((handler) => handler(event));
    },
  };
}

describe("database resource", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockGetDatabaseConfig.mockReturnValue({
      queryLoggingEnabled: false,
      slowQueryThresholdMs: 250,
    });
  });

  it("connects once and reuses the same Prisma client", async () => {
    const firstClient = createMockDatabaseClient();
    mockPrismaClient.mockReturnValue(firstClient.client);

    const databaseModule = await import("@/configuration/resources/database");

    const connected = await databaseModule.connectDatabase();
    const connectedAgain = await databaseModule.connectDatabase();

    expect(mockPrismaClient).toHaveBeenCalledTimes(1);
    expect(firstClient.client.$connect).toHaveBeenCalledTimes(2);
    expect(connectedAgain).toBe(connected);
    expect(databaseModule.getDatabaseClient()).toBe(firstClient.client);
    expect(databaseModule.databaseClient).toBe(firstClient.client);
    expect(mockLoggerInfo).toHaveBeenCalledWith("Database connected.", {
      durationMs: expect.any(Number),
    });
  });

  it("logs slow queries as warnings and regular query logging as info", async () => {
    const queryLoggingClient = createMockDatabaseClient();
    mockGetDatabaseConfig.mockReturnValueOnce({
      queryLoggingEnabled: true,
      slowQueryThresholdMs: 250,
    });
    mockPrismaClient.mockReturnValueOnce(queryLoggingClient.client);

    const firstModule = await import("@/configuration/resources/database");
    await firstModule.connectDatabase();

    queryLoggingClient.emitQuery({
      duration: 25,
      query: "SELECT 1",
      target: "User",
    });

    expect(mockLoggerInfo).toHaveBeenCalledWith("Database query completed.", {
      durationMs: 25,
      query: "SELECT 1",
      target: "User",
    });

    await firstModule.disconnectDatabase();

    const slowQueryClient = createMockDatabaseClient();
    mockGetDatabaseConfig.mockReturnValueOnce({
      queryLoggingEnabled: false,
      slowQueryThresholdMs: 100,
    });
    mockPrismaClient.mockReturnValueOnce(slowQueryClient.client);

    const secondModule = await import("@/configuration/resources/database");
    await secondModule.connectDatabase();

    slowQueryClient.emitQuery({
      duration: 150,
      query: "SELECT * FROM bookings",
      target: "Booking",
    });

    expect(mockLoggerWarn).toHaveBeenCalledWith("Database query completed.", {
      durationMs: 150,
      query: "SELECT * FROM bookings",
      target: "Booking",
    });
  });

  it("disconnects cleanly, clears the cached client, and no-ops when already disconnected", async () => {
    const mockClient = createMockDatabaseClient();
    mockPrismaClient.mockReturnValue(mockClient.client);

    const databaseModule = await import("@/configuration/resources/database");
    await databaseModule.connectDatabase();
    await databaseModule.disconnectDatabase();

    expect(mockClient.client.$disconnect).toHaveBeenCalledTimes(1);
    expect(databaseModule.databaseClient).toBeNull();
    expect(mockLoggerInfo).toHaveBeenCalledWith("Database disconnected.", {
      durationMs: expect.any(Number),
    });

    await expect(databaseModule.disconnectDatabase()).resolves.toBeUndefined();
  });

  it("pings the database through a raw query and rejects reads before initialization", async () => {
    const databaseModule = await import("@/configuration/resources/database");

    expect(() => databaseModule.getDatabaseClient()).toThrow(
      "Database has not been initialized. Call connectDatabase() first.",
    );

    const mockClient = createMockDatabaseClient();
    mockPrismaClient.mockReturnValue(mockClient.client);

    await databaseModule.connectDatabase();

    await expect(databaseModule.pingDatabase()).resolves.toEqual({
      durationMs: expect.any(Number),
      ok: true,
    });
    expect(mockClient.client.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
