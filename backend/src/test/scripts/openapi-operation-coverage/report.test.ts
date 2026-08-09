import { buildOperationCatalog } from "@/openapi/coverage/catalog";
import {
  parseCoverageConfig,
  withArgvOverrides,
  type CoverageConfig,
} from "@/openapi/coverage/config";
import type { SiteMatch } from "@/openapi/coverage/matcher";
import {
  buildCoverageReport,
  evaluateGate,
  formatCoverageReport,
} from "@/openapi/coverage/report";
import type {
  ExtractionResult,
  RequestSite,
  SuiteKind,
} from "@/openapi/coverage/request-sites";

const catalog = buildOperationCatalog({
  paths: {
    "/postings": { get: { operationId: "listPostings", tags: ["postings"] } },
    "/postings/{id}": {
      get: { operationId: "getPostingById", tags: ["postings"] },
    },
    "/feedback": { post: { operationId: "createFeedback", tags: ["feedback"] } },
  },
});

const baseConfig: CoverageConfig = {
  mode: "warn",
  failOnUnresolvedSites: false,
  failOnStaleExceptions: false,
  smokeOnlyTestFiles: [],
  exceptions: [],
};

function site(
  suite: SuiteKind,
  level: "explicit" | "smoke" = "explicit",
): RequestSite {
  return {
    file: `src/test/${suite}.integration.test.ts`,
    line: 10,
    suite,
    level,
    requests: [],
    rawUrlText: "<test>",
    resolution: "resolved",
  };
}

function match(
  suite: SuiteKind,
  operationKeys: string[],
  level: "explicit" | "smoke" = "explicit",
): SiteMatch {
  return {
    site: site(suite, level),
    operationKeys,
    quality: "exact",
    ambiguous: false,
    unmatchedRequests: [],
  };
}

const emptyExtraction: ExtractionResult = { sites: [], skippedFiles: [] };

function report(matches: SiteMatch[], config: CoverageConfig = baseConfig) {
  return buildCoverageReport({
    catalog,
    matches,
    extraction: emptyExtraction,
    config,
  });
}

describe("buildCoverageReport", () => {
  it("marks an operation covered by both suites", () => {
    const result = report([
      match("route-contract", ["GET /postings"]),
      match("persistence", ["GET /postings"]),
    ]);

    const coverage = result.operations.find(
      (entry) => entry.operation.key === "GET /postings",
    );

    expect(coverage!.status).toBe("covered-both");
    expect(result.totals.both).toBe(1);
    expect(result.totals.covered).toBe(1);
  });

  it("distinguishes route-contract from persistence coverage", () => {
    const result = report([
      match("route-contract", ["GET /postings"]),
      match("persistence", ["POST /feedback"]),
    ]);

    expect(
      result.operations.find((entry) => entry.operation.key === "GET /postings")!
        .status,
    ).toBe("covered-route-contract");
    expect(
      result.operations.find((entry) => entry.operation.key === "POST /feedback")!
        .status,
    ).toBe("covered-persistence");
  });

  it("never counts a smoke probe as covered", () => {
    const result = report([
      match("route-contract", ["GET /postings"], "smoke"),
    ]);

    expect(
      result.operations.find((entry) => entry.operation.key === "GET /postings")!
        .status,
    ).toBe("smoke-only");
    expect(result.totals.covered).toBe(0);
    expect(result.totals.smokeOnly).toBe(1);
  });

  it("counts everything else as uncovered", () => {
    const result = report([]);

    expect(result.totals.uncovered).toBe(3);
    expect(result.totals.operations).toBe(3);
  });

  it("rolls tag totals up to the overall totals", () => {
    const result = report([match("persistence", ["GET /postings"])]);
    const postings = result.byTag.find((tag) => tag.tag === "postings");

    expect(postings).toMatchObject({ operations: 2, covered: 1, uncovered: 1 });
    expect(
      result.byTag.reduce((sum, tag) => sum + tag.operations, 0),
    ).toBe(result.totals.operations);
  });

  describe("exceptions", () => {
    const withException = (
      operationId: string,
      expiresOn: string | null = null,
    ): CoverageConfig => ({
      ...baseConfig,
      exceptions: [{ operationId, reason: "documented", expiresOn }],
    });

    it("exempts an uncovered operation", () => {
      const result = report([], withException("listPostings"));

      expect(
        result.operations.find(
          (entry) => entry.operation.key === "GET /postings",
        )!.status,
      ).toBe("exempt");
      expect(result.totals.exempt).toBe(1);
      expect(result.totals.uncovered).toBe(2);
      expect(result.staleExceptions).toEqual([]);
    });

    it("reports an exception for an unknown operationId as stale", () => {
      const result = report([], withException("noSuchOperation"));

      expect(result.staleExceptions).toEqual([
        expect.stringContaining("noSuchOperation"),
      ]);
    });

    it("reports an exception for a now-covered operation as stale", () => {
      const result = report(
        [match("persistence", ["GET /postings"])],
        withException("listPostings"),
      );

      expect(result.staleExceptions).toEqual([
        expect.stringContaining("now covered-persistence"),
      ]);
    });

    it("reports an expired exception as stale and stops exempting", () => {
      const result = report([], withException("listPostings", "2000-01-01"));

      expect(
        result.operations.find(
          (entry) => entry.operation.key === "GET /postings",
        )!.status,
      ).toBe("uncovered");
      expect(result.staleExceptions).toEqual([
        expect.stringContaining("expired on 2000-01-01"),
      ]);
    });
  });
});

describe("evaluateGate", () => {
  it("returns 0 in warn mode even with uncovered operations", () => {
    expect(evaluateGate(report([]), baseConfig)).toBe(0);
  });

  it("returns 1 in enforce mode with uncovered operations", () => {
    const enforce: CoverageConfig = { ...baseConfig, mode: "enforce" };
    expect(evaluateGate(report([], enforce), enforce)).toBe(1);
  });

  it("returns 0 in enforce mode when every gap is exempted", () => {
    const enforce: CoverageConfig = {
      ...baseConfig,
      mode: "enforce",
      exceptions: [
        { operationId: "listPostings", reason: "r", expiresOn: null },
        { operationId: "getPostingById", reason: "r", expiresOn: null },
        { operationId: "createFeedback", reason: "r", expiresOn: null },
      ],
    };

    expect(evaluateGate(report([], enforce), enforce)).toBe(0);
  });

  it("honours failOnUnresolvedSites only when enabled", () => {
    const unresolved: ExtractionResult = {
      sites: [
        {
          ...site("route-contract"),
          resolution: "unresolved",
          unresolvedReason: "dynamic-origin",
        },
      ],
      skippedFiles: [],
    };

    const build = (config: CoverageConfig) =>
      buildCoverageReport({
        catalog,
        matches: [
          match("persistence", ["GET /postings"]),
          match("persistence", ["GET /postings/{id}"]),
          match("persistence", ["POST /feedback"]),
        ],
        extraction: unresolved,
        config,
      });

    const lenient: CoverageConfig = { ...baseConfig, mode: "enforce" };
    const strict: CoverageConfig = { ...lenient, failOnUnresolvedSites: true };

    expect(evaluateGate(build(lenient), lenient)).toBe(0);
    expect(evaluateGate(build(strict), strict)).toBe(1);
  });
});

describe("formatCoverageReport", () => {
  it("is deterministic and states the gate mode", () => {
    const result = report([match("persistence", ["GET /postings"])]);

    const first = formatCoverageReport(result, baseConfig);
    const second = formatCoverageReport(result, baseConfig);

    expect(first).toBe(second);
    expect(first).toContain("mode: warn");
    expect(first).toContain("Warn-only mode: exiting 0.");
    expect(first).toMatch(/Uncovered operations \(2\)/);
  });
});

describe("config parsing", () => {
  it("defaults unknown modes to warn and coerces exception shapes", () => {
    const config = parseCoverageConfig(
      JSON.stringify({
        mode: "something-else",
        smokeOnlyTestFiles: ["a.ts", 5],
        exceptions: [{ operationId: "x", reason: "y" }, "nope"],
      }),
    );

    expect(config.mode).toBe("warn");
    expect(config.smokeOnlyTestFiles).toEqual(["a.ts"]);
    expect(config.exceptions).toEqual([
      { operationId: "x", reason: "y", addedOn: undefined, expiresOn: null },
    ]);
  });

  it("lets argv override the committed mode in both directions", () => {
    expect(withArgvOverrides(baseConfig, ["--enforce"]).mode).toBe("enforce");
    expect(
      withArgvOverrides({ ...baseConfig, mode: "enforce" }, ["--warn"]).mode,
    ).toBe("warn");
  });
});
