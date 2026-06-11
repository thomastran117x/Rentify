function waitForLogger(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 25);
  });
}

function spyStream(stream: NodeJS.WriteStream) {
  return jest.spyOn(stream, "write").mockImplementation(((chunk, callback) => {
    if (typeof callback === "function") {
      callback(null);
    }

    return true;
  }) as never);
}

async function loadLoggingModuleWithEnvironment(options?: {
  fallbackToProcessEnv?: boolean;
  level?: "debug" | "info" | "warn" | "error" | "critical";
  environment?: "development" | "test" | "production";
}) {
  const {
    fallbackToProcessEnv = false,
    level = "debug",
    environment = "development",
  } = options ?? {};

  jest.doMock("@/configuration/environment", () => ({
    environment: fallbackToProcessEnv
      ? {
          getLoggingConfig: () => {
            throw new Error("missing logging config");
          },
          getRabbitMqConfig: () => {
            throw new Error("missing rabbit config");
          },
        }
      : {
          getLoggingConfig: () => ({
            fallbackDirectory: "C:/tmp/logger",
            level,
            mode: "console",
            serviceName: "backend-test",
          }),
          getRabbitMqConfig: () => ({
            url: "",
          }),
          getNodeEnvironment: () => environment,
        },
  }));

  return import("@/configuration/logging");
}

describe("logger branches", () => {
  const originalEnv = {
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_SILENT: process.env.LOG_SILENT,
    NODE_ENV: process.env.NODE_ENV,
    RABBITMQ_URL: process.env.RABBITMQ_URL,
  };

  afterEach(() => {
    process.env.LOG_LEVEL = originalEnv.LOG_LEVEL;
    process.env.LOG_SILENT = originalEnv.LOG_SILENT;
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.RABBITMQ_URL = originalEnv.RABBITMQ_URL;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("defaults invalid env and level values through the console logger fallback", async () => {
    process.env.NODE_ENV = "mystery";
    process.env.LOG_LEVEL = "LOUD";
    process.env.LOG_SILENT = "false";

    const stdoutSpy = spyStream(process.stdout);
    const { loggerFactory } = await loadLoggingModuleWithEnvironment({
      fallbackToProcessEnv: true,
    });

    loggerFactory.forComponent("branch.test", "service").info("Fallback info.");

    await waitForLogger();

    const output = stdoutSpy.mock.calls
      .map(([message]) => String(message))
      .join("\n");
    expect(output).toContain("Fallback info.");
    expect(output).toContain("env=development");
  });

  it("suppresses logs below the configured threshold and writes warnings to stderr", async () => {
    const stdoutSpy = spyStream(process.stdout);
    const stderrSpy = spyStream(process.stderr);
    process.env.LOG_SILENT = "false";
    const { loggerFactory } = await loadLoggingModuleWithEnvironment({
      level: "warn",
      environment: "development",
    });

    loggerFactory.forComponent("branch.test", "service").debug("Hidden debug.");
    loggerFactory.forComponent("   ", "service").warn("Visible warning.", {
      ok: true,
      message: "reserved",
      extra: undefined,
    });

    await waitForLogger();

    const stdoutOutput = stdoutSpy.mock.calls
      .map(([message]) => String(message))
      .join("\n");
    const stderrOutput = stderrSpy.mock.calls
      .map(([message]) => String(message))
      .join("\n");

    expect(stdoutOutput).not.toContain("Hidden debug.");
    expect(stdoutOutput).toContain("Visible warning.");
    expect(stdoutOutput).toContain("service/anonymous");
    expect(stdoutOutput).toContain("ok=true");
    expect(stdoutOutput).not.toContain("message=reserved");
    expect(stderrOutput).toBe("");
  });

  it("merges contextual fields and normalizes plain-object errors", async () => {
    class ExampleService {}

    const stderrSpy = spyStream(process.stderr);
    process.env.LOG_SILENT = "false";
    const { loggerFactory } = await loadLoggingModuleWithEnvironment({
      level: "debug",
      environment: "development",
    });
    const baseLogger = loggerFactory.forClass(ExampleService, "service");
    const contextualLogger = loggerFactory.fromContext(baseLogger, {
      requestId: "req-7",
      fields: {
        feature: "logging",
        component: "reserved",
        drop: undefined,
      },
    });

    contextualLogger.error(
      "Plain-object failure.",
      {
        extra: true,
        layer: "ignored",
      },
      {
        name: "PlainError",
        message: "bad input",
        code: "E_BAD",
      },
    );

    await waitForLogger();

    const output = stderrSpy.mock.calls
      .map(([message]) => String(message))
      .join("\n");
    expect(output).toContain("service/ExampleService");
    expect(output).toContain("requestId=req-7");
    expect(output).toContain("feature=logging");
    expect(output).toContain("extra=true");
    expect(output).toContain("error=PlainError: bad input");
    expect(output).not.toContain("component=reserved");
    expect(output).not.toContain("layer=ignored");
  });
});
