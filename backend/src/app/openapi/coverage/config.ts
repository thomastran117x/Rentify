import { readFileSync } from "node:fs";
import { join } from "node:path";

export const COVERAGE_CONFIG_FILENAME = "openapi-coverage.config.json";

export interface CoverageException {
  readonly operationId: string;
  readonly reason: string;
  readonly addedOn?: string;
  readonly expiresOn?: string | null;
}

export interface CoverageConfig {
  /** `warn` always exits 0; `enforce` fails the build on a coverage gap. */
  readonly mode: "warn" | "enforce";
  readonly failOnUnresolvedSites: boolean;
  readonly failOnStaleExceptions: boolean;
  /** Repo-relative test files whose requests are smoke probes, not real coverage. */
  readonly smokeOnlyTestFiles: readonly string[];
  readonly exceptions: readonly CoverageException[];
}

const DEFAULT_CONFIG: CoverageConfig = {
  mode: "warn",
  failOnUnresolvedSites: false,
  failOnStaleExceptions: false,
  smokeOnlyTestFiles: [],
  exceptions: [],
};

export function loadCoverageConfig(projectRoot: string): CoverageConfig {
  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, COVERAGE_CONFIG_FILENAME), "utf8");
  } catch {
    return DEFAULT_CONFIG;
  }

  return parseCoverageConfig(raw);
}

export function parseCoverageConfig(raw: string): CoverageConfig {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  return {
    mode: parsed.mode === "enforce" ? "enforce" : "warn",
    failOnUnresolvedSites: parsed.failOnUnresolvedSites === true,
    failOnStaleExceptions: parsed.failOnStaleExceptions === true,
    smokeOnlyTestFiles: Array.isArray(parsed.smokeOnlyTestFiles)
      ? parsed.smokeOnlyTestFiles.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    exceptions: Array.isArray(parsed.exceptions)
      ? parsed.exceptions
          .filter(
            (entry): entry is Record<string, unknown> =>
              typeof entry === "object" && entry !== null,
          )
          .map((entry) => ({
            operationId: String(entry.operationId ?? ""),
            reason: String(entry.reason ?? ""),
            addedOn:
              typeof entry.addedOn === "string" ? entry.addedOn : undefined,
            expiresOn:
              typeof entry.expiresOn === "string" ? entry.expiresOn : null,
          }))
      : [],
  };
}

export function withArgvOverrides(
  config: CoverageConfig,
  argv: readonly string[],
): CoverageConfig {
  if (argv.includes("--enforce")) {
    return { ...config, mode: "enforce" };
  }

  if (argv.includes("--warn")) {
    return { ...config, mode: "warn" };
  }

  return config;
}
