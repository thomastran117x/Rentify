import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EnvironmentManager } from "@/configuration/environment/manager";

const ORIGINAL_ENV = { ...process.env };

function buildRequiredEnv(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "mysql://process:process@localhost:3306/rent_process",
    ACCESS_TOKEN_SECRET: "process-access-secret-value-with-32chars",
    REFRESH_TOKEN_SECRET: "process-refresh-secret-value-with-32ch",
    PERSONAL_ACCESS_TOKEN_SECRET: "process-personal-token-secret-32chars",
    GMAIL_USER: "process@example.com",
    GMAIL_APP_PASSWORD: "process-password",
    SQUARE_ACCESS_TOKEN: "process-square-token",
    SQUARE_LOCATION_ID: "process-square-location",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "process-square-signature-key",
    SQUARE_WEBHOOK_NOTIFICATION_URL:
      "http://localhost:8040/api/v1/payments/webhooks/square",
    ...overrides,
  };
}

function serializeEnv(values: NodeJS.ProcessEnv): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

describe("EnvironmentManager", () => {
  let tempDirectory: string;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    tempDirectory = mkdtempSync(join(tmpdir(), "rent-env-manager-"));
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("loads successfully when the optional env file is missing", () => {
    process.env = buildRequiredEnv();

    const manager = new EnvironmentManager({
      envFilePath: join(tempDirectory, ".env"),
    });

    const environment = manager.load();

    expect(environment.database.url).toBe(process.env.DATABASE_URL);
  });

  it("loads values from an optional local env file when present", () => {
    const envFilePath = join(tempDirectory, ".env");
    writeFileSync(
      envFilePath,
      serializeEnv(
        buildRequiredEnv({
          DATABASE_URL: "mysql://file:file@localhost:3306/rent_file",
          FRONTEND_URL: "http://localhost:3041",
        }),
      ),
    );
    process.env = {};

    const manager = new EnvironmentManager({ envFilePath });

    const environment = manager.load();

    expect(environment.database.url).toBe(
      "mysql://file:file@localhost:3306/rent_file",
    );
    expect(environment.cors.allowedOrigins).toEqual(["http://localhost:3041"]);
    expect(process.env.FRONTEND_URL).toBe("http://localhost:3041");
  });

  it("does not let the env file override existing process env values", () => {
    const envFilePath = join(tempDirectory, ".env");
    writeFileSync(
      envFilePath,
      serializeEnv(
        buildRequiredEnv({
          DATABASE_URL: "mysql://file:file@localhost:3306/rent_file",
          ACCESS_TOKEN_SECRET: "file-access-secret-value-with-32chars",
        }),
      ),
    );
    process.env = buildRequiredEnv({
      DATABASE_URL: "mysql://process:process@localhost:3306/rent_process",
      ACCESS_TOKEN_SECRET: "process-access-secret-value-with-32chars",
    });

    const manager = new EnvironmentManager({ envFilePath });

    const environment = manager.load();

    expect(environment.database.url).toBe(
      "mysql://process:process@localhost:3306/rent_process",
    );
    expect(environment.auth.accessTokenSecret).toBe(
      "process-access-secret-value-with-32chars",
    );
    expect(process.env.DATABASE_URL).toBe(
      "mysql://process:process@localhost:3306/rent_process",
    );
  });
});
