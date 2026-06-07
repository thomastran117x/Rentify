import { jest } from "@jest/globals";

async function waitFor(assertion: () => void, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }
  }

  assertion();
}

describe("logger failure handling", () => {
  const originalEnv = {
    LOG_FALLBACK_DIRECTORY: process.env.LOG_FALLBACK_DIRECTORY,
    LOG_SILENT: process.env.LOG_SILENT,
    NODE_ENV: process.env.NODE_ENV,
    RABBITMQ_URL: process.env.RABBITMQ_URL,
  };

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.LOG_FALLBACK_DIRECTORY = originalEnv.LOG_FALLBACK_DIRECTORY;
    process.env.LOG_SILENT = originalEnv.LOG_SILENT;
    process.env.RABBITMQ_URL = originalEnv.RABBITMQ_URL;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("emits a direct console error when both primary and fallback logging fail", async () => {
    process.env.NODE_ENV = "production";
    process.env.RABBITMQ_URL = "";
    process.env.LOG_FALLBACK_DIRECTORY = "C:/tmp/logger-failure";
    process.env.LOG_SILENT = "false";

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const loggingModule = await import("@/configuration/logging");
    const dispatcher = (
      loggingModule.loggerFactory as {
        dispatcher: {
          queueService: {
            publishLogEvent: (event: unknown) => Promise<void>;
          };
          getFallbackFileWriter: (fallbackDirectory: string) => {
            write: (event: unknown) => Promise<void>;
          };
        };
      }
    ).dispatcher;
    const originalPublishLogEvent = dispatcher.queueService.publishLogEvent;
    const originalGetFallbackFileWriter = dispatcher.getFallbackFileWriter;

    dispatcher.queueService.publishLogEvent = jest.fn(async () => {
      throw new Error("publish failed");
    });
    dispatcher.getFallbackFileWriter = jest.fn(() => ({
      write: async () => {
        throw new Error("mkdir failed");
      },
    }));

    loggingModule.loggerFactory
      .forComponent("logger.test", "service")
      .critical("Total logging failure.");

    try {
      await waitFor(() => {
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
    } finally {
      dispatcher.queueService.publishLogEvent = originalPublishLogEvent;
      dispatcher.getFallbackFileWriter = originalGetFallbackFileWriter;
    }
  });
});
