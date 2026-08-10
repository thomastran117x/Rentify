import type { OperationCatalogEntry } from "@/openapi/coverage/catalog";
import type { CoverageConfig } from "@/openapi/coverage/config";
import type { SiteMatch } from "@/openapi/coverage/matcher";
import type {
  ExtractionResult,
  RequestSite,
} from "@/openapi/coverage/request-sites";

export type OperationStatus =
  | "covered-both"
  | "covered-route-contract"
  | "covered-persistence"
  | "smoke-only"
  | "uncovered"
  | "exempt";

export interface SiteRef {
  readonly file: string;
  readonly line: number;
}

export interface OperationCoverage {
  readonly operation: OperationCatalogEntry;
  readonly status: OperationStatus;
  readonly routeContractSites: readonly SiteRef[];
  readonly persistenceSites: readonly SiteRef[];
  readonly smokeSites: readonly SiteRef[];
}

export interface CoverageTotals {
  readonly operations: number;
  readonly covered: number;
  readonly routeContract: number;
  readonly persistence: number;
  readonly both: number;
  readonly smokeOnly: number;
  readonly uncovered: number;
  readonly exempt: number;
}

export interface TagTotals extends CoverageTotals {
  readonly tag: string;
}

export interface CoverageReport {
  readonly totals: CoverageTotals;
  readonly byTag: readonly TagTotals[];
  readonly operations: readonly OperationCoverage[];
  readonly unresolvedSites: readonly RequestSite[];
  readonly wildcardFallbackSites: readonly SiteMatch[];
  readonly ambiguousSites: readonly SiteMatch[];
  /** Resolved sites that matched no operation: likely a typo or a dead path. */
  readonly unmatchedSites: readonly SiteMatch[];
  readonly staleExceptions: readonly string[];
  readonly skippedFiles: ExtractionResult["skippedFiles"];
  readonly analysedFiles: number;
  readonly routeContractFiles: number;
  readonly persistenceFiles: number;
}

export interface BuildCoverageReportInput {
  readonly catalog: readonly OperationCatalogEntry[];
  readonly matches: readonly SiteMatch[];
  readonly extraction: ExtractionResult;
  readonly config: CoverageConfig;
}

function toSiteRef(site: RequestSite): SiteRef {
  return { file: site.file, line: site.line };
}

function emptyTotals(): {
  operations: number;
  covered: number;
  routeContract: number;
  persistence: number;
  both: number;
  smokeOnly: number;
  uncovered: number;
  exempt: number;
} {
  return {
    operations: 0,
    covered: 0,
    routeContract: 0,
    persistence: 0,
    both: 0,
    smokeOnly: 0,
    uncovered: 0,
    exempt: 0,
  };
}

function accumulate(
  totals: ReturnType<typeof emptyTotals>,
  coverage: OperationCoverage,
): void {
  totals.operations += 1;

  if (coverage.routeContractSites.length > 0) totals.routeContract += 1;
  if (coverage.persistenceSites.length > 0) totals.persistence += 1;

  switch (coverage.status) {
    case "covered-both":
      totals.covered += 1;
      totals.both += 1;
      break;
    case "covered-route-contract":
    case "covered-persistence":
      totals.covered += 1;
      break;
    case "smoke-only":
      totals.smokeOnly += 1;
      break;
    case "exempt":
      totals.exempt += 1;
      break;
    case "uncovered":
      totals.uncovered += 1;
      break;
  }
}

export function buildCoverageReport({
  catalog,
  matches,
  extraction,
  config,
}: BuildCoverageReportInput): CoverageReport {
  const routeContractSites = new Map<string, SiteRef[]>();
  const persistenceSites = new Map<string, SiteRef[]>();
  const smokeSites = new Map<string, SiteRef[]>();

  for (const match of matches) {
    if (match.site.resolution === "unresolved") continue;

    const target =
      match.site.level === "smoke"
        ? smokeSites
        : match.site.suite === "route-contract"
          ? routeContractSites
          : persistenceSites;

    for (const key of match.operationKeys) {
      const refs = target.get(key) ?? [];
      refs.push(toSiteRef(match.site));
      target.set(key, refs);
    }
  }

  const exceptionsById = new Map(
    config.exceptions
      .filter((exception) => exception.operationId.length > 0)
      .map((exception) => [exception.operationId, exception]),
  );
  const usedExceptionIds = new Set<string>();
  const now = Date.now();

  const operations: OperationCoverage[] = catalog.map((operation) => {
    const routeRefs = routeContractSites.get(operation.key) ?? [];
    const persistenceRefs = persistenceSites.get(operation.key) ?? [];
    const smokeRefs = smokeSites.get(operation.key) ?? [];

    let status: OperationStatus;
    if (routeRefs.length > 0 && persistenceRefs.length > 0) {
      status = "covered-both";
    } else if (routeRefs.length > 0) {
      status = "covered-route-contract";
    } else if (persistenceRefs.length > 0) {
      status = "covered-persistence";
    } else if (smokeRefs.length > 0) {
      status = "smoke-only";
    } else {
      status = "uncovered";
    }

    const exception = exceptionsById.get(operation.operationId);
    if (exception) {
      usedExceptionIds.add(exception.operationId);
      const expired =
        typeof exception.expiresOn === "string" &&
        Number.isFinite(Date.parse(exception.expiresOn)) &&
        Date.parse(exception.expiresOn) < now;

      if (!expired && (status === "uncovered" || status === "smoke-only")) {
        status = "exempt";
      }
    }

    return {
      operation,
      status,
      routeContractSites: routeRefs,
      persistenceSites: persistenceRefs,
      smokeSites: smokeRefs,
    };
  });

  const staleExceptions: string[] = [];
  for (const exception of config.exceptions) {
    if (!usedExceptionIds.has(exception.operationId)) {
      staleExceptions.push(
        `${exception.operationId} (no such operationId in the OpenAPI document)`,
      );
      continue;
    }

    // Expiry is reported ahead of coverage status: an expired exception stops
    // exempting, so it would otherwise be reported as merely "now uncovered".
    if (
      typeof exception.expiresOn === "string" &&
      Number.isFinite(Date.parse(exception.expiresOn)) &&
      Date.parse(exception.expiresOn) < now
    ) {
      staleExceptions.push(
        `${exception.operationId} (expired on ${exception.expiresOn})`,
      );
      continue;
    }

    const coverage = operations.find(
      (entry) => entry.operation.operationId === exception.operationId,
    );

    if (coverage && coverage.status !== "exempt") {
      staleExceptions.push(
        `${exception.operationId} (now ${coverage.status}; remove the exception)`,
      );
    }
  }

  const totals = emptyTotals();
  const tagTotals = new Map<string, ReturnType<typeof emptyTotals>>();

  for (const coverage of operations) {
    accumulate(totals, coverage);
    const tags = coverage.operation.tags.length
      ? coverage.operation.tags
      : ["untagged"];

    for (const tag of tags) {
      const bucket = tagTotals.get(tag) ?? emptyTotals();
      accumulate(bucket, coverage);
      tagTotals.set(tag, bucket);
    }
  }

  const analysedFiles = new Set(extraction.sites.map((site) => site.file));
  const routeContractFiles = new Set(
    extraction.sites
      .filter((site) => site.suite === "route-contract")
      .map((site) => site.file),
  );
  const persistenceFiles = new Set(
    extraction.sites
      .filter((site) => site.suite === "persistence")
      .map((site) => site.file),
  );

  return {
    totals,
    byTag: [...tagTotals.entries()]
      .map(([tag, bucket]) => ({ tag, ...bucket }))
      .sort((left, right) => left.tag.localeCompare(right.tag)),
    operations,
    unresolvedSites: extraction.sites.filter(
      (site) => site.resolution === "unresolved",
    ),
    wildcardFallbackSites: matches.filter(
      (match) => match.quality === "wildcard-fallback",
    ),
    ambiguousSites: matches.filter((match) => match.ambiguous),
    unmatchedSites: matches.filter(
      (match) => match.unmatchedRequests.length > 0,
    ),
    staleExceptions,
    skippedFiles: extraction.skippedFiles,
    analysedFiles: analysedFiles.size,
    routeContractFiles: routeContractFiles.size,
    persistenceFiles: persistenceFiles.size,
  };
}

/** Returns the process exit code. Warn mode always returns 0. */
export function evaluateGate(
  report: CoverageReport,
  config: CoverageConfig,
): number {
  if (config.mode === "warn") {
    return 0;
  }

  const failures = [
    report.totals.uncovered > 0,
    report.totals.smokeOnly > 0,
    report.unmatchedSites.length > 0,
    config.failOnUnresolvedSites && report.unresolvedSites.length > 0,
    config.failOnStaleExceptions && report.staleExceptions.length > 0,
  ];

  return failures.some(Boolean) ? 1 : 0;
}

function padEnd(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function formatOperationLine(coverage: OperationCoverage): string {
  const { operation } = coverage;
  return `  ${padEnd(operation.method, 7)} ${padEnd(operation.path, 55)} ${padEnd(
    operation.operationId,
    38,
  )} [${operation.tags.join(", ")}]`;
}

export function formatCoverageReport(
  report: CoverageReport,
  config: CoverageConfig,
): string {
  const lines: string[] = [];
  const { totals } = report;
  const percentage =
    totals.operations === 0
      ? "0.0"
      : ((totals.covered / totals.operations) * 100).toFixed(1);

  lines.push(`OpenAPI operation integration coverage  (mode: ${config.mode})`);
  lines.push("");
  lines.push("Inventory");
  lines.push(`  OpenAPI operations ...................... ${totals.operations}`);
  lines.push(
    `  Integration test files analysed ......... ${report.analysedFiles}`,
  );
  lines.push(
    `  Unresolved request sites ................ ${report.unresolvedSites.length}`,
  );
  lines.push(
    `  Files skipped (no route composition) .... ${report.skippedFiles.length}`,
  );
  lines.push("");
  lines.push("Coverage");
  lines.push(
    `  Covered ................................. ${totals.covered}  (${percentage}%)`,
  );
  if (totals.smokeOnly > 0) {
    lines.push(
      `  Smoke-only (NOT counted as covered) ..... ${totals.smokeOnly}`,
    );
  }
  lines.push(`  Uncovered ............................... ${totals.uncovered}`);
  lines.push(`  Exempted (manifest) ..................... ${totals.exempt}`);
  lines.push("");

  lines.push("By tag");
  lines.push(
    `  ${padEnd("tag", 26)}${padStart("total", 6)}${padStart("covered", 9)}${padStart("uncovered", 11)}`,
  );
  for (const tag of report.byTag) {
    lines.push(
      `  ${padEnd(tag.tag, 26)}${padStart(String(tag.operations), 6)}` +
        `${padStart(String(tag.covered), 9)}${padStart(String(tag.uncovered), 11)}`,
    );
  }
  lines.push(
    `  ${padEnd("TOTAL", 26)}${padStart(String(totals.operations), 6)}` +
      `${padStart(String(totals.covered), 9)}${padStart(String(totals.uncovered), 11)}`,
  );
  lines.push("");

  const uncovered = report.operations.filter(
    (coverage) => coverage.status === "uncovered",
  );
  lines.push(`Uncovered operations (${uncovered.length})`);
  uncovered.forEach((coverage) => lines.push(formatOperationLine(coverage)));
  lines.push("");

  const smokeOnly = report.operations.filter(
    (coverage) => coverage.status === "smoke-only",
  );
  lines.push(
    `Smoke-only operations (${smokeOnly.length})   -- generic reachability probes only; not behaviour coverage`,
  );
  smokeOnly.forEach((coverage) => {
    lines.push(formatOperationLine(coverage));
    coverage.smokeSites.forEach((site) =>
      lines.push(`      ${site.file}:${site.line}`),
    );
  });
  lines.push("");

  const exempt = report.operations.filter(
    (coverage) => coverage.status === "exempt",
  );
  if (exempt.length > 0) {
    lines.push(`Exempted operations (${exempt.length})`);
    exempt.forEach((coverage) => lines.push(formatOperationLine(coverage)));
    lines.push("");
  }

  lines.push(`Unresolved request sites (${report.unresolvedSites.length})`);
  report.unresolvedSites.forEach((site) =>
    lines.push(
      `  ${site.file}:${site.line}  [${site.unresolvedReason}]  ${site.rawUrlText}`,
    ),
  );

  lines.push(
    `Wildcard-fallback sites (${report.wildcardFallbackSites.length})`,
  );
  report.wildcardFallbackSites.forEach((match) =>
    lines.push(`  ${match.site.file}:${match.site.line}  ${match.site.rawUrlText}`),
  );

  lines.push(`Ambiguous sites (${report.ambiguousSites.length})`);
  report.ambiguousSites.forEach((match) =>
    lines.push(
      `  ${match.site.file}:${match.site.line}  -> ${match.operationKeys.join(" | ")}`,
    ),
  );

  lines.push(
    `Resolved sites matching no operation (${report.unmatchedSites.length})`,
  );
  report.unmatchedSites.forEach((match) =>
    match.unmatchedRequests.forEach((request) =>
      lines.push(
        `  ${match.site.file}:${match.site.line}  ${request.method} ${request.pathPattern}`,
      ),
    ),
  );

  lines.push(`Stale manifest exceptions (${report.staleExceptions.length})`);
  report.staleExceptions.forEach((entry) => lines.push(`  ${entry}`));
  lines.push("");

  if (config.mode === "warn") {
    lines.push("Warn-only mode: exiting 0.");
    lines.push(
      'Set "mode": "enforce" in openapi-coverage.config.json to fail the build on uncovered operations.',
    );
  }

  return `${lines.join("\n")}\n`;
}

