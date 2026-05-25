import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import rootLogger, { logger, loggerFactory } from "@/configuration/logging";

function waitForLogger(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 25);
  });
}

describe("logger", () => {
  const originalEnv = {
    LOG_FALLBACK_DIRECTORY: process.env.LOG_FALLBACK_DIRECTORY,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_SERVICE_NAME: process.env.LOG_SERVICE_NAME,
    NODE_ENV: process.env.NODE_ENV,
    RABBITMQ_URL: process.env.RABBITMQ_URL,
  };

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.LOG_LEVEL = originalEnv.LOG_LEVEL;
    process.env.LOG_SERVICE_NAME = originalEnv.LOG_SERVICE_NAME;
    process.env.LOG_FALLBACK_DIRECTORY = originalEnv.LOG_FALLBACK_DIRECTORY;
    process.env.RABBITMQ_URL = originalEnv.RABBITMQ_URL;
    jest.restoreAllMocks();
  });

  it("exports the precreated root logger as both default and named export", () => {
    expect(rootLogger).toBe(logger);
  });

  it("logs pretty terminal output in development", async () => {
    process.env.NODE_ENV = "development";
    process.env.LOG_LEVEL = "debug";

    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
      callback?: unknown,
    ) => {
      if (typeof callback === "function") {
        callback(null);
      }

      return true;
    }) as never);

    loggerFactory
      .forComponent("logger.test", "service")
      .child({ requestId: "req-1", fields: { feature: "logging" } })
      .info("Logger ready.");

    await waitForLogger();

    const output = writeSpy.mock.calls
      .map(([message]) => String(message))
      .join("\n");
    expect(output).toContain("Logger ready.");
    expect(output).toContain("service/logger.test");
    expect(output).toContain("requestId=req-1");
    expect(output).toContain("feature=logging");
  });

  it("falls back to a local log file when production cannot publish to RabbitMQ", async () => {
    process.env.NODE_ENV = "production";
    process.env.RABBITMQ_URL = "";
    process.env.LOG_LEVEL = "debug";
    process.env.LOG_SERVICE_NAME = "backend-test";

    const tempDirectory = await mkdtemp(path.join(tmpdir(), "rent-logger-"));
    process.env.LOG_FALLBACK_DIRECTORY = tempDirectory;

    loggerFactory
      .forComponent("logger.test", "service")
      .child({ requestId: "request-42", fields: { phase: "fallback" } })
      .error("Broker unavailable.");

    await waitForLogger();

    const fileContent = await readFile(
      path.join(tempDirectory, "application.log.jsonl"),
      "utf8",
    );
    const [firstLine] = fileContent.trim().split("\n");
    const event = JSON.parse(firstLine ?? "{}") as Record<string, unknown>;

    expect(event.message).toBe("Broker unavailable.");
    expect(event.component).toBe("logger.test");
    expect(event.layer).toBe("service");
    expect(event.requestId).toBe("request-42");
    expect(event.service).toBe("backend-test");
    expect(event.fields).toEqual(
      expect.objectContaining({
        phase: "fallback",
      }),
    );

    await rm(tempDirectory, {
      force: true,
      recursive: true,
    });
  });
});
