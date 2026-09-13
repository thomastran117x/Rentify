import { readBootstrapLoggingConfig } from "@/configuration/environment/bootstrap";

describe("bootstrap logging configuration", () => {
  it("retains safe process overrides for failures before configuration loads", () => {
    expect(
      readBootstrapLoggingConfig({
        NODE_ENV: "production",
        LOG_FALLBACK_DIRECTORY: "/var/log/rent",
        LOG_LEVEL: "critical",
        LOG_SERVICE_NAME: "rent-api",
        LOG_SILENT: "false",
        RABBITMQ_URL: "amqp://logger:secret@rabbitmq:5672",
      }),
    ).toEqual({
      environment: "production",
      fallbackDirectory: "/var/log/rent",
      level: "critical",
      mode: "rabbitmq",
      rabbitMqUrl: "amqp://logger:secret@rabbitmq:5672",
      serviceName: "rent-api",
      silent: false,
    });
  });

  it("uses conservative defaults and permits an explicit CI logging override", () => {
    expect(
      readBootstrapLoggingConfig({
        CI: "true",
        NODE_ENV: "test",
      }),
    ).toMatchObject({
      environment: "test",
      fallbackDirectory: "/app/logs/fallback",
      level: "info",
      mode: "console",
      serviceName: "backend",
      silent: true,
    });

    expect(
      readBootstrapLoggingConfig({
        CI: "true",
        LOG_SILENT: "false",
        NODE_ENV: "test",
      }).silent,
    ).toBe(false);
  });
});
