import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  flattenConfigurationDocument,
  mergeConfigurationDocuments,
  readConfigurationDocument,
} from "@/configuration/environment/file";

describe("YAML configuration files", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "rent-config-file-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("deep-merges mappings while replacing arrays and honoring null", () => {
    expect(
      mergeConfigurationDocuments(
        {
          application: { name: "Rent", frontendUrl: "http://base" },
          cors: { allowedOrigins: ["http://base"] },
        },
        {
          application: { frontendUrl: null },
          cors: { allowedOrigins: ["http://overlay"] },
        },
      ),
    ).toEqual({
      application: { name: "Rent", frontendUrl: null },
      cors: { allowedOrigins: ["http://overlay"] },
    });
  });

  it("flattens structured values and marks file feature provenance", () => {
    expect(
      flattenConfigurationDocument({
        server: { port: 9000 },
        cors: { allowedOrigins: ["https://one.test", "https://two.test"] },
        features: { SEARCH_V2: { enabled: true } },
      }),
    ).toEqual({
      raw: {
        PORT: "9000",
        CORS_ALLOWED_ORIGINS: "https://one.test,https://two.test",
      },
      features: {
        "search-v2": { enabled: true, source: "config" },
      },
    });
  });

  it("rejects malformed YAML, unknown keys, and secret keys", () => {
    const malformedPath = join(directory, "malformed.yml");
    const unknownPath = join(directory, "unknown.yml");
    const secretPath = join(directory, "secret.yml");
    writeFileSync(malformedPath, "server: [", "utf8");
    writeFileSync(unknownPath, "server:\n  mystery: true\n", "utf8");
    writeFileSync(secretPath, "ACCESS_TOKEN_SECRET: forbidden\n", "utf8");

    expect(() => readConfigurationDocument(malformedPath)).toThrow(
      `Unable to read configuration file ${malformedPath}`,
    );
    expect(() => readConfigurationDocument(unknownPath)).toThrow(
      "unknown key server.mystery",
    );
    expect(() => readConfigurationDocument(secretPath)).toThrow(
      "unknown key ACCESS_TOKEN_SECRET",
    );
  });

  it("rejects invalid feature shapes", () => {
    const filePath = join(directory, "features.yml");
    writeFileSync(
      filePath,
      "features:\n  search-v2:\n    enabled: yes\n    extra: false\n",
      "utf8",
    );

    expect(() => readConfigurationDocument(filePath)).toThrow(
      "features.search-v2",
    );
  });

  it("rejects values whose type does not match the configured field", () => {
    const filePath = join(directory, "invalid-type.yml");
    writeFileSync(filePath, "server:\n  port: eight-thousand\n", "utf8");

    expect(() => readConfigurationDocument(filePath)).toThrow(
      `Invalid configuration file ${filePath}: server.port must be a number.`,
    );
  });

  it("does not interpolate environment expressions", () => {
    const filePath = join(directory, "literal.yml");
    writeFileSync(filePath, 'application:\n  name: "${APP_NAME}"\n', "utf8");

    expect(
      flattenConfigurationDocument(readConfigurationDocument(filePath)).raw
        .APP_NAME,
    ).toBe("${APP_NAME}");
  });
});
