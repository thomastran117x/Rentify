import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { executeNpm } from "./npm-security-check.mjs";

// Each workspace's `audit` script runs this in place of `npm audit
// --audit-level=high`. It applies the same gate, except that an advisory listed
// in audit-exceptions.json for that workspace is accepted until its review date.
// Everything else at or above the level still fails, so the list only ever
// excuses the advisories someone has reviewed and written down.

const SEVERITY_RANK = Object.freeze({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 });
const DEFAULT_AUDIT_LEVEL = "high";
const EXCEPTIONS_PATH = join(dirname(fileURLToPath(import.meta.url)), "audit-exceptions.json");
const ADVISORY_ID_PATTERN = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_EXCEPTION_FIELDS = Object.freeze([
  "workspace",
  "advisory",
  "package",
  "reason",
  "exitCriterion",
  "reviewBy",
]);

/** The GHSA id at the end of an advisory URL, or the URL itself if it has none. */
function advisoryIdOf(url) {
  return url.split("/").at(-1);
}

/**
 * Validates the parsed exceptions file and returns its entries. Throws on any
 * malformed entry, so a typo cannot quietly excuse nothing or everything.
 */
export function parseExceptions(document) {
  if (!document || !Array.isArray(document.exceptions)) {
    throw new TypeError('audit-exceptions.json must be an object with an "exceptions" array.');
  }

  return document.exceptions.map((entry, index) => {
    const where = `audit-exceptions.json entry ${index}`;

    for (const field of REQUIRED_EXCEPTION_FIELDS) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
        throw new TypeError(`${where} is missing "${field}".`);
      }
    }
    if (!ADVISORY_ID_PATTERN.test(entry.advisory)) {
      throw new TypeError(`${where} has an advisory "${entry.advisory}" that is not a GHSA id.`);
    }
    if (!DATE_PATTERN.test(entry.reviewBy) || Number.isNaN(Date.parse(`${entry.reviewBy}T00:00:00Z`))) {
      throw new TypeError(`${where} has a reviewBy "${entry.reviewBy}" that is not a YYYY-MM-DD date.`);
    }

    return entry;
  });
}

/**
 * The advisories behind one vulnerable package. npm reports a transitive
 * package's `via` as the names of the packages it depends on, so those are
 * followed down to the packages that carry the advisories themselves.
 */
function collectAdvisories(name, vulnerabilities, seen = new Set()) {
  if (seen.has(name)) {
    return [];
  }
  seen.add(name);

  const vulnerability = vulnerabilities[name];
  if (!vulnerability) {
    return [];
  }

  return vulnerability.via.flatMap((via) =>
    typeof via === "string"
      ? collectAdvisories(via, vulnerabilities, seen)
      : [{ id: advisoryIdOf(via.url), package: via.name, severity: via.severity, title: via.title, url: via.url }],
  );
}

/**
 * Decides the gate for one workspace's `npm audit --json` report.
 *
 * Returns the advisories that fail it, those accepted by an exception, the
 * exceptions past their review date (which fail it too, so an exception is
 * revisited rather than kept by default), and the exceptions that matched
 * nothing, which can be deleted.
 */
export function evaluateAudit({ report, exceptions, workspace, today, auditLevel = DEFAULT_AUDIT_LEVEL }) {
  if (!(auditLevel in SEVERITY_RANK)) {
    throw new TypeError(`Unknown audit level "${auditLevel}".`);
  }

  const threshold = SEVERITY_RANK[auditLevel];
  const ownExceptions = exceptions.filter((exception) => exception.workspace === workspace);
  const exceptionFor = (advisory) =>
    ownExceptions.find(
      (exception) => exception.advisory === advisory.id && exception.package === advisory.package,
    );

  const blocking = new Map();
  const accepted = new Map();
  const usedExceptions = new Set();

  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    if ((SEVERITY_RANK[vulnerability.severity] ?? 0) < threshold) {
      continue;
    }

    for (const advisory of collectAdvisories(name, report.vulnerabilities)) {
      if ((SEVERITY_RANK[advisory.severity] ?? 0) < threshold) {
        continue;
      }

      const key = `${advisory.package}:${advisory.id}`;
      const exception = exceptionFor(advisory);

      if (exception) {
        usedExceptions.add(exception);
        accepted.set(key, { ...advisory, exception });
      } else {
        blocking.set(key, advisory);
      }
    }
  }

  const expired = ownExceptions.filter((exception) => exception.reviewBy < today);
  const unused = ownExceptions.filter((exception) => !usedExceptions.has(exception));

  return {
    blocking: [...blocking.values()],
    accepted: [...accepted.values()],
    expired,
    unused,
    passed: blocking.size === 0 && expired.length === 0,
  };
}

function formatResult(result, workspace, auditLevel) {
  const lines = [];

  for (const advisory of result.accepted) {
    lines.push(
      `Accepted ${advisory.severity} ${advisory.id} in ${advisory.package} (review by ${advisory.exception.reviewBy}): ${advisory.title}`,
    );
  }
  for (const exception of result.expired) {
    lines.push(
      `Expired exception for ${exception.advisory} in ${exception.package}: its review date ${exception.reviewBy} has passed. Re-check it and update or remove it in scripts/audit-exceptions.json.`,
    );
  }
  for (const exception of result.unused) {
    lines.push(
      `Unused exception for ${exception.advisory} in ${exception.package}: npm audit no longer reports it here, so it can be removed from scripts/audit-exceptions.json.`,
    );
  }
  for (const advisory of result.blocking) {
    lines.push(`Blocking ${advisory.severity} ${advisory.id} in ${advisory.package}: ${advisory.title} - ${advisory.url}`);
  }

  lines.push(
    result.passed
      ? `npm audit gate passed for ${workspace} at --audit-level=${auditLevel}.`
      : `npm audit gate failed for ${workspace} at --audit-level=${auditLevel}. Run \`npm audit\` for the dependency paths and fixes.`,
  );

  return `${lines.join("\n")}\n`;
}

/**
 * Runs `npm audit --json` and applies the gate. When npm produced no report,
 * such as during a registry outage, its own output and exit code are passed
 * through unchanged, so npm-security-check can still recognise and retry the
 * outage.
 */
export async function runAuditGate({
  workspace = basename(process.cwd()),
  auditLevel = DEFAULT_AUDIT_LEVEL,
  today = new Date().toISOString().slice(0, 10),
  execute = executeNpm,
  loadExceptions = async () => JSON.parse(await readFile(EXCEPTIONS_PATH, "utf8")),
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  const exceptions = parseExceptions(await loadExceptions());
  const result = await execute(["audit", "--json"]);

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = null;
  }

  if (!report || report.error || typeof report.vulnerabilities !== "object") {
    stdout.write(result.stdout);
    stderr.write(result.stderr);
    return { exitCode: result.exitCode || 1, outcome: "unavailable" };
  }

  const evaluation = evaluateAudit({ report, exceptions, workspace, today, auditLevel });
  (evaluation.passed ? stdout : stderr).write(formatResult(evaluation, workspace, auditLevel));

  return { exitCode: evaluation.passed ? 0 : 1, outcome: evaluation.passed ? "passed" : "failed", evaluation };
}

function parseArguments(argv) {
  let auditLevel = DEFAULT_AUDIT_LEVEL;

  for (const argument of argv) {
    const match = /^--audit-level=(\w+)$/.exec(argument);
    if (!match) {
      throw new TypeError(`Unknown argument "${argument}".`);
    }
    auditLevel = match[1];
  }

  return { auditLevel };
}

async function main() {
  try {
    const { auditLevel } = parseArguments(process.argv.slice(2));
    const result = await runAuditGate({ auditLevel });
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    if (error instanceof TypeError) {
      process.stderr.write("Usage: node ../scripts/npm-audit-gate.mjs [--audit-level=<info|low|moderate|high|critical>]\n");
      process.exitCode = 2;
    } else {
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
