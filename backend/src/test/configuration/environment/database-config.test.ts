import { buildDatabaseConfig } from "@/configuration/environment/domains/infrastructure";
import type { RawEnvironmentValues } from "@/configuration/environment/types";

const DATABASE_URL = "mysql://rent:rent@localhost:3306/rent";

function buildPoolConfig(raw: RawEnvironmentValues, errors: string[]) {
  return buildDatabaseConfig(raw, "development", errors, DATABASE_URL);
}

describe("buildDatabaseConfig connection pool options", () => {
  it("defaults to a bounded pool that holds a single idle connection", () => {
    const errors: string[] = [];
    const config = buildPoolConfig({}, errors);

    expect(config.poolConnectionLimit).toBe(10);
    expect(config.poolMinimumIdle).toBe(1);
    expect(errors).toEqual([]);
  });

  it("parses explicitly configured pool sizes", () => {
    const errors: string[] = [];
    const config = buildPoolConfig(
      {
        DATABASE_POOL_CONNECTION_LIMIT: "5",
        DATABASE_POOL_MINIMUM_IDLE: "2",
      },
      errors,
    );

    expect(config.poolConnectionLimit).toBe(5);
    expect(config.poolMinimumIdle).toBe(2);
    expect(errors).toEqual([]);
  });

  // A minimumIdle of 0 stalls the driver's pool: it only creates connections to
  // satisfy minimumIdle and never to satisfy a queued request, so every acquire
  // would wait out the full acquire timeout instead of opening a connection.
  it("rejects a minimum idle of zero because the pool would never grow", () => {
    const errors: string[] = [];
    const config = buildPoolConfig({ DATABASE_POOL_MINIMUM_IDLE: "0" }, errors);

    expect(config.poolMinimumIdle).toBe(1);
    expect(errors).toEqual([
      "DATABASE_POOL_MINIMUM_IDLE must be greater than or equal to 1.",
    ]);
  });

  it("rejects a non-numeric connection limit and falls back to the default", () => {
    const errors: string[] = [];
    const config = buildPoolConfig(
      { DATABASE_POOL_CONNECTION_LIMIT: "abc" },
      errors,
    );

    expect(config.poolConnectionLimit).toBe(10);
    expect(errors).toEqual([
      "DATABASE_POOL_CONNECTION_LIMIT must be a valid number.",
    ]);
  });

  it("rejects a fractional connection limit", () => {
    const errors: string[] = [];
    const config = buildPoolConfig(
      { DATABASE_POOL_CONNECTION_LIMIT: "2.5" },
      errors,
    );

    expect(config.poolConnectionLimit).toBe(10);
    expect(errors).toEqual([
      "DATABASE_POOL_CONNECTION_LIMIT must be an integer.",
    ]);
  });

  // The driver clamps this silently, so the misconfiguration has to surface here.
  it("rejects a minimum idle larger than the connection limit", () => {
    const errors: string[] = [];
    const config = buildPoolConfig(
      {
        DATABASE_POOL_CONNECTION_LIMIT: "2",
        DATABASE_POOL_MINIMUM_IDLE: "3",
      },
      errors,
    );

    expect(config.poolConnectionLimit).toBe(2);
    expect(config.poolMinimumIdle).toBe(3);
    expect(errors).toEqual([
      "DATABASE_POOL_MINIMUM_IDLE must be less than or equal to DATABASE_POOL_CONNECTION_LIMIT.",
    ]);
  });
});
