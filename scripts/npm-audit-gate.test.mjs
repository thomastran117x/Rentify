import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAudit, parseExceptions, runAuditGate } from "./npm-audit-gate.mjs";
import { isRetryableRegistryFailure } from "./npm-security-check.mjs";

const BRACES_ADVISORY = {
  source: 1240992,
  name: "braces",
  dependency: "braces",
  title: "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns",
  url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
  severity: "high",
};

/** The shape npm reported for the braces advisory in the frontend. */
function bracesReport(extra = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      braces: { name: "braces", severity: "high", via: [BRACES_ADVISORY], effects: ["micromatch"] },
      micromatch: { name: "micromatch", severity: "high", via: ["braces"], effects: ["fast-glob"] },
      "fast-glob": { name: "fast-glob", severity: "high", via: ["micromatch"], effects: ["@next/eslint-plugin-next"] },
      "@next/eslint-plugin-next": {
        name: "@next/eslint-plugin-next",
        severity: "high",
        via: ["fast-glob"],
        effects: ["eslint-config-next"],
      },
      "eslint-config-next": {
        name: "eslint-config-next",
        severity: "high",
        via: ["@next/eslint-plugin-next"],
        effects: [],
      },
      ...extra,
    },
    metadata: {},
  };
}

function exception(overrides = {}) {
  return {
    workspace: "frontend",
    advisory: "GHSA-vfj7-8cjw-p6xm",
    package: "braces",
    reason: "Lint-time only.",
    exitCriterion: "A patched braces ships.",
    reviewBy: "2027-01-04",
    ...overrides,
  };
}

const TODAY = "2026-10-04";

test("passes a report with no vulnerabilities", () => {
  const result = evaluateAudit({
    report: { vulnerabilities: {} },
    exceptions: [],
    workspace: "backend",
    today: TODAY,
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.blocking, []);
});

test("accepts an excepted advisory however many packages it reaches through", () => {
  const result = evaluateAudit({
    report: bracesReport(),
    exceptions: [exception()],
    workspace: "frontend",
    today: TODAY,
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(
    result.accepted.map((advisory) => advisory.id),
    ["GHSA-vfj7-8cjw-p6xm"],
  );
  assert.deepEqual(result.unused, []);
});

test("blocks the same advisory without an exception", () => {
  const result = evaluateAudit({ report: bracesReport(), exceptions: [], workspace: "frontend", today: TODAY });

  assert.equal(result.passed, false);
  assert.deepEqual(
    result.blocking.map((advisory) => `${advisory.package}:${advisory.id}`),
    ["braces:GHSA-vfj7-8cjw-p6xm"],
  );
});

test("applies an exception only to its own workspace and package", () => {
  for (const other of [exception({ workspace: "backend" }), exception({ package: "micromatch" })]) {
    const result = evaluateAudit({
      report: bracesReport(),
      exceptions: [other],
      workspace: "frontend",
      today: TODAY,
    });

    assert.equal(result.passed, false);
  }
});

test("still blocks any other high advisory beside an accepted one", () => {
  const result = evaluateAudit({
    report: bracesReport({
      lodash: {
        name: "lodash",
        severity: "critical",
        via: [
          {
            name: "lodash",
            title: "Prototype pollution",
            url: "https://github.com/advisories/GHSA-jf85-cpcp-j695",
            severity: "critical",
          },
        ],
      },
    }),
    exceptions: [exception()],
    workspace: "frontend",
    today: TODAY,
  });

  assert.equal(result.passed, false);
  assert.deepEqual(
    result.blocking.map((advisory) => advisory.id),
    ["GHSA-jf85-cpcp-j695"],
  );
  assert.equal(result.accepted.length, 1);
});

test("ignores advisories below the audit level", () => {
  const result = evaluateAudit({
    report: {
      vulnerabilities: {
        esbuild: {
          name: "esbuild",
          severity: "low",
          via: [{ name: "esbuild", title: "Dev server read", url: "https://github.com/advisories/GHSA-g7r4-m6w7-qqqr", severity: "low" }],
        },
      },
    },
    exceptions: [],
    workspace: "backend",
    today: TODAY,
  });

  assert.equal(result.passed, true);
});

test("fails once an exception's review date has passed", () => {
  const result = evaluateAudit({
    report: bracesReport(),
    exceptions: [exception({ reviewBy: "2026-10-03" })],
    workspace: "frontend",
    today: TODAY,
  });

  assert.equal(result.passed, false);
  assert.deepEqual(result.blocking, []);
  assert.equal(result.expired.length, 1);
});

test("reports an exception that no longer matches anything, without failing", () => {
  const result = evaluateAudit({
    report: { vulnerabilities: {} },
    exceptions: [exception()],
    workspace: "frontend",
    today: TODAY,
  });

  assert.equal(result.passed, true);
  assert.equal(result.unused.length, 1);
});

test("refuses an unknown audit level", () => {
  assert.throws(
    () => evaluateAudit({ report: bracesReport(), exceptions: [], workspace: "frontend", today: TODAY, auditLevel: "severe" }),
    TypeError,
  );
});

test("rejects a malformed exceptions file", () => {
  assert.throws(() => parseExceptions({}), /"exceptions" array/);
  assert.throws(() => parseExceptions({ exceptions: [exception({ reason: "" })] }), /missing "reason"/);
  assert.throws(() => parseExceptions({ exceptions: [exception({ advisory: "CVE-2024-4068" })] }), /not a GHSA id/);
  assert.throws(() => parseExceptions({ exceptions: [exception({ reviewBy: "next quarter" })] }), /not a YYYY-MM-DD/);
  assert.equal(parseExceptions({ exceptions: [exception()] }).length, 1);
});

function harness(npmResult, exceptions = [exception()]) {
  const stdout = [];
  const stderr = [];
  const calls = [];

  return {
    stdout,
    stderr,
    calls,
    options: {
      workspace: "frontend",
      today: TODAY,
      execute: async (args) => {
        calls.push(args);
        return npmResult;
      },
      loadExceptions: async () => ({ exceptions }),
      stdout: { write: (chunk) => stdout.push(chunk) },
      stderr: { write: (chunk) => stderr.push(chunk) },
    },
  };
}

test("runs npm audit --json and passes with the exception applied", async () => {
  const { options, calls, stdout } = harness({ exitCode: 1, stdout: JSON.stringify(bracesReport()), stderr: "" });

  const result = await runAuditGate(options);

  assert.deepEqual(calls, [["audit", "--json"]]);
  assert.equal(result.exitCode, 0);
  assert.match(stdout.join(""), /Accepted high GHSA-vfj7-8cjw-p6xm in braces/);
});

test("fails with the blocking advisory named", async () => {
  const { options, stderr } = harness({ exitCode: 1, stdout: JSON.stringify(bracesReport()), stderr: "" }, []);

  const result = await runAuditGate(options);

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join(""), /Blocking high GHSA-vfj7-8cjw-p6xm in braces/);
});

test("passes npm's own output through when it produced no report, so an outage can be retried", async () => {
  const outage = {
    exitCode: 1,
    stdout: JSON.stringify({ error: { code: "E503", summary: "Service Unavailable" } }, null, 2),
    stderr: "npm warn audit 503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk\n",
  };
  const { options, stdout, stderr } = harness(outage);

  const result = await runAuditGate(options);

  assert.equal(result.exitCode, 1);
  assert.equal(result.outcome, "unavailable");
  assert.equal(isRetryableRegistryFailure(`${stdout.join("")}\n${stderr.join("")}`), true);
});
