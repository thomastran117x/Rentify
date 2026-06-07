const mockConnect = jest.fn();
const mockGetRabbitMqConfig = jest.fn(() => ({
  url: "amqp://rent.test",
}));
const mockLoggerError = jest.fn();

jest.mock("amqplib", () => ({
  connect: (...args: unknown[]) => mockConnect(...args),
}));

jest.mock("@/configuration/environment/index", () => ({
  environment: {
    getRabbitMqConfig: (...args: unknown[]) => mockGetRabbitMqConfig(...args),
  },
}));

jest.mock("@/configuration/logging", () => ({
  loggerFactory: {
    forComponent: () => ({
      error: (...args: unknown[]) => mockLoggerError(...args),
    }),
  },
}));

function createMockConnection() {
  const eventHandlers = new Map<string, (...args: unknown[]) => void>();
  const createConfirmChannel = jest.fn(async () => ({
    id: "channel-1",
  }));
  const close = jest.fn(async () => undefined);

  return {
    connection: {
      createConfirmChannel,
      close,
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers.set(event, handler);
      }),
    },
    emit: (event: string, ...args: unknown[]) => {
      eventHandlers.get(event)?.(...args);
    },
    createConfirmChannel,
    close,
  };
}

async function loadRabbitMqModule() {
  return import("@/configuration/resources/rabbitmq");
}

describe("rabbitmq resource", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockGetRabbitMqConfig.mockReturnValue({
      url: "amqp://rent.test",
    });
  });

  it("reports whether RabbitMQ is enabled from the configured URL", async () => {
    const rabbitMq = await loadRabbitMqModule();

    expect(rabbitMq.isRabbitMqEnabled()).toBe(true);

    mockGetRabbitMqConfig.mockReturnValue({
      url: "",
    });

    expect(rabbitMq.isRabbitMqEnabled()).toBe(false);
  });

  it("caches the connection, logs connection errors, and reconnects after close", async () => {
    const first = createMockConnection();
    const second = createMockConnection();
    mockConnect.mockResolvedValueOnce(first.connection).mockResolvedValueOnce(
      second.connection,
    );
    const rabbitMq = await loadRabbitMqModule();

    const initial = await rabbitMq.connectRabbitMq();
    const cached = await rabbitMq.connectRabbitMq();

    expect(initial).toBe(first.connection);
    expect(cached).toBe(first.connection);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(rabbitMq.getRabbitMqConnection()).toBe(first.connection);

    const error = new Error("broker lost");
    first.emit("error", error);

    expect(mockLoggerError).toHaveBeenCalledWith(
      "RabbitMQ connection error.",
      undefined,
      error,
    );

    first.emit("close");

    const reconnected = await rabbitMq.connectRabbitMq();

    expect(reconnected).toBe(second.connection);
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("creates channels and disconnects the cached connection", async () => {
    const mockConnection = createMockConnection();
    mockConnect.mockResolvedValue(mockConnection.connection);
    const rabbitMq = await loadRabbitMqModule();

    await expect(rabbitMq.createRabbitMqChannel()).resolves.toEqual({
      id: "channel-1",
    });
    expect(mockConnection.createConfirmChannel).toHaveBeenCalledTimes(1);

    await rabbitMq.disconnectRabbitMq();
    await rabbitMq.disconnectRabbitMq();

    expect(mockConnection.close).toHaveBeenCalledTimes(1);
    expect(() => rabbitMq.getRabbitMqConnection()).toThrow(
      "RabbitMQ has not been initialized. Call connectRabbitMq() first.",
    );
  });

  it("throws when RabbitMQ has not been configured", async () => {
    mockGetRabbitMqConfig.mockReturnValue({
      url: "",
    });
    const rabbitMq = await loadRabbitMqModule();

    await expect(rabbitMq.connectRabbitMq()).rejects.toThrow(
      "RabbitMQ has not been configured. Set RABBITMQ_URL first.",
    );
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("throws when callers ask for a connection before initialization", async () => {
    const rabbitMq = await loadRabbitMqModule();

    expect(() => rabbitMq.getRabbitMqConnection()).toThrow(
      "RabbitMQ has not been initialized. Call connectRabbitMq() first.",
    );
  });
});
