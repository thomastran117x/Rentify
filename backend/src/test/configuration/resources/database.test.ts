const mockPrismaClient = jest.fn();
const mockPrismaMariaDb = jest.fn();
const mockGetDatabaseConfig = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock("@/generated/prisma/client", () => ({
  PrismaClient: function PrismaClient(...args: unknown[]) {
    return mockPrismaClient(...args);
  },
}));

// Prisma 7 connects through a driver adapter. Stubbed at the boundary so these
// stay unit tests -- the real adapter validates the connection string eagerly.
jest.mock("@prisma/adapter-mariadb", () => ({
  PrismaMariaDb: function PrismaMariaDb(...args: unknown[]) {
    return mockPrismaMariaDb(...args);
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
      url: "mysql://rent:rent@localhost:3306/rent",
      poolConnectionLimit: 10,
      poolMinimumIdle: 1,
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
    expect(mockPrismaMariaDb).toHaveBeenCalledTimes(1);
    expect(mockPrismaMariaDb).toHaveBeenCalledWith(
      "mysql://rent:rent@localhost:3306/rent?connectionLimit=10&minimumIdle=1",
    );
    expect(firstClient.client.$connect).toHaveBeenCalledTimes(2);
    expect(connectedAgain).toBe(connected);
    expect(databaseModule.getDatabaseClient()).toBe(firstClient.client);
    expect(databaseModule.databaseClient).toBe(firstClient.client);
    expect(mockLoggerInfo).toHaveBeenCalledWith("Database connected.", {
      durationMs: expect.any(Number),
    });
  });

  it("keeps existing connection string parameters and overrides embedded pool sizing", async () => {
    const mockClient = createMockDatabaseClient();
    mockPrismaClient.mockReturnValue(mockClient.client);
    mockGetDatabaseConfig.mockReturnValue({
      url: "mysql://rent:rent@localhost:3306/rent?ssl=true&connectionLimit=99",
      poolConnectionLimit: 5,
      poolMinimumIdle: 2,
      queryLoggingEnabled: false,
      slowQueryThresholdMs: 250,
    });

    const databaseModule = await import("@/configuration/resources/database");
    await databaseModule.connectDatabase();

    const connectionString = mockPrismaMariaDb.mock.calls[0][0] as string;

    expect(connectionString).toContain("ssl=true");
    expect(connectionString).toContain("connectionLimit=5");
    expect(connectionString).toContain("minimumIdle=2");
    expect(connectionString).not.toContain("99");
  });

  it("falls back to the raw connection string without leaking credentials when it cannot be parsed", async () => {
    const mockClient = createMockDatabaseClient();
    mockPrismaClient.mockReturnValue(mockClient.client);
    mockGetDatabaseConfig.mockReturnValue({
      url: "not-a-valid-url",
      poolConnectionLimit: 10,
      poolMinimumIdle: 1,
      queryLoggingEnabled: false,
      slowQueryThresholdMs: 250,
    });

    const databaseModule = await import("@/configuration/resources/database");
    await databaseModule.connectDatabase();

    expect(mockPrismaMariaDb).toHaveBeenCalledWith("not-a-valid-url");
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "Database URL could not be parsed, so connection pool sizing was not applied.",
    );
    expect(JSON.stringify(mockLoggerWarn.mock.calls)).not.toContain(
      "not-a-valid-url",
    );
  });

  it("logs slow queries as warnings and regular query logging as info", async () => {
    const queryLoggingClient = createMockDatabaseClient();
    mockGetDatabaseConfig.mockReturnValueOnce({
      url: "mysql://rent:rent@localhost:3306/rent",
      poolConnectionLimit: 10,
      poolMinimumIdle: 1,
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
      url: "mysql://rent:rent@localhost:3306/rent",
      poolConnectionLimit: 10,
      poolMinimumIdle: 1,
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
