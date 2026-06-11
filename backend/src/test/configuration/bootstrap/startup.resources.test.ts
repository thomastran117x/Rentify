const mockDisconnectRabbitMq = jest.fn(async () => undefined);
const mockDisconnectRedis = jest.fn(async () => undefined);
const mockDisconnectDatabase = jest.fn(async () => undefined);
const mockDisconnectElasticsearch = jest.fn(async () => undefined);

jest.mock("@/configuration/bootstrap/application", () => ({
  createApplication: jest.fn(),
}));

jest.mock("@/configuration/bootstrap/container", () => ({
  initializeContainer: jest.fn(),
}));

jest.mock("@/configuration/environment", () => ({
  environment: {
    getServerPort: () => 8040,
  },
  loadEnvironment: jest.fn(),
}));

jest.mock("@/configuration/resources/elasticsearch", () => ({
  connectElasticsearch: jest.fn(),
  disconnectElasticsearch: (...args: unknown[]) =>
    mockDisconnectElasticsearch(...args),
}));

jest.mock("@/configuration/resources/database", () => ({
  connectDatabase: jest.fn(),
  disconnectDatabase: (...args: unknown[]) => mockDisconnectDatabase(...args),
}));

jest.mock("@/configuration/resources/redis", () => ({
  connectRedis: jest.fn(),
  disconnectRedis: (...args: unknown[]) => mockDisconnectRedis(...args),
}));

jest.mock("@/configuration/resources/rabbitmq", () => ({
  connectRabbitMq: jest.fn(),
  disconnectRabbitMq: (...args: unknown[]) => mockDisconnectRabbitMq(...args),
  isRabbitMqEnabled: jest.fn(),
}));

jest.mock("@/seeds/orchestrator", () => ({
  runAutoSeedsIfNeeded: jest.fn(),
}));

describe("disconnectApplicationResources", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("attempts to disconnect every backing resource even when one fails", async () => {
    const rabbitError = new Error("broker close failed");
    mockDisconnectRabbitMq.mockRejectedValueOnce(rabbitError);

    const startupModule = await import("@/configuration/bootstrap/startup");

    await expect(
      startupModule.disconnectApplicationResources(),
    ).resolves.toBeUndefined();

    expect(mockDisconnectRabbitMq).toHaveBeenCalledTimes(1);
    expect(mockDisconnectRedis).toHaveBeenCalledTimes(1);
    expect(mockDisconnectDatabase).toHaveBeenCalledTimes(1);
    expect(mockDisconnectElasticsearch).toHaveBeenCalledTimes(1);
  });
});
