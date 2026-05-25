import { jest } from "@jest/globals";

function waitForLogger(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
}

describe("logger failure handling", () => {
  const originalEnv = {
    LOG_FALLBACK_DIRECTORY: process.env.LOG_FALLBACK_DIRECTORY,
    NODE_ENV: process.env.NODE_ENV,
    RABBITMQ_URL: process.env.RABBITMQ_URL,
  };

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.LOG_FALLBACK_DIRECTORY = originalEnv.LOG_FALLBACK_DIRECTORY;
    process.env.RABBITMQ_URL = originalEnv.RABBITMQ_URL;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("emits a direct console error when both primary and fallback logging fail", async () => {
    process.env.NODE_ENV = "production";
    process.env.RABBITMQ_URL = "";
    process.env.LOG_FALLBACK_DIRECTORY = "C:/tmp/logger-failure";

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    jest.unstable_mockModule("@/configuration/logging/log-queue.service", () => ({
      ApplicationLogQueueService: class {
        async publishLogEvent(): Promise<void> {
          throw new Error("publish failed");
        }

        async disconnect(): Promise<void> {}
      },
    }));

    jest.unstable_mockModule("node:fs/promises", async () => {
      const actual = await jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");

      return {
        ...actual,
        mkdir: jest.fn(async () => {
          throw new Error("mkdir failed");
        }),
      };
    });

    const loggingModule = await import("@/configuration/logging");
    loggingModule.loggerFactory.forComponent("logger.test", "service").critical("Total logging failure.");

    await waitForLogger();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[LOGGER FAILURE] Failed to persist log event.",
      expect.objectContaining({
        originalEvent: expect.objectContaining({
          component: "logger.test",
          level: "critical",
          message: "Total logging failure.",
        }),
      }),
    );
  });
});
