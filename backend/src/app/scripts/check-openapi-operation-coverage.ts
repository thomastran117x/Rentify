import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildOperationCatalog } from "@/openapi/coverage/catalog";
import {
  loadCoverageConfig,
  withArgvOverrides,
} from "@/openapi/coverage/config";
import { matchRequestSites } from "@/openapi/coverage/matcher";
import {
  buildCoverageReport,
  evaluateGate,
  formatCoverageReport,
} from "@/openapi/coverage/report";
import {
  extractRequestSites,
  type SourceDocument,
} from "@/openapi/coverage/request-sites";
import { buildOpenApiDocument } from "@/openapi/spec";
import { validateOpenApiRouteCoverage } from "@/openapi/validation";

function readTestDocuments(
  directory: string,
  projectRoot: string,
): SourceDocument[] {
  const documents: SourceDocument[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      documents.push(...readTestDocuments(filePath, projectRoot));
    } else if (
      entry.isFile() &&
      filePath.endsWith(".integration.test.ts")
    ) {
      documents.push({
        path: relative(projectRoot, filePath),
        source: readFileSync(filePath, "utf8"),
      });
    }
  }

  return documents;
}

export async function main(
  projectRoot = process.cwd(),
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const config = withArgvOverrides(loadCoverageConfig(projectRoot), argv);
  const document = buildOpenApiDocument() as unknown as Record<string, unknown>;

  // Fails loudly if the spec and the route source have drifted, so coverage is
  // never reported against a stale inventory.
  await validateOpenApiRouteCoverage(document);

  const catalog = buildOperationCatalog(document);
  const documents = readTestDocuments(join(projectRoot, "src/test"), projectRoot);
  const extraction = extractRequestSites(documents, {
    smokeOnlyTestFiles: config.smokeOnlyTestFiles,
  });
  const matches = matchRequestSites(extraction.sites, catalog);
  const report = buildCoverageReport({ catalog, matches, extraction, config });

  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatCoverageReport(report, config));
  }

  process.exitCode = evaluateGate(report, config);
}
