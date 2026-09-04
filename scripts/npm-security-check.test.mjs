import assert from "node:assert/strict";
import test from "node:test";

import { isRetryableRegistryFailure, runSecurityCheck } from "./npm-security-check.mjs";

const success = { exitCode: 0, stdout: "found 0 vulnerabilities\n", stderr: "" };
const serviceUnavailable = {
  exitCode: 1,
  stdout: "{ error: 'Service Unavailable' }\n",
  stderr:
    "npm warn audit 503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk\n" +
    "npm error audit endpoint returned an error\n",
};

function createHarness(results) {
  const calls = [];
  const executionOptions = [];
  const delays = [];
  const reports = [];
  const stdout = [];
  const stderr = [];

  return {
    calls,
    executionOptions,
    delays,
    reports,
    stdout,
    stderr,
    options: {
      execute: async (args, options) => {
        calls.push(args);
        executionOptions.push(options);
        return results[calls.length - 1];
      },
      wait: async (delay) => delays.push(delay),
      report: async (details) => reports.push(details),
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: (value) => stderr.push(value) },
    },
  };
}

test("passes an advisory audit on its first attempt", async () => {
  const harness = createHarness([success]);
  const result = await runSecurityCheck({
    check: "advisories",
    outagePolicy: "warn",
    ...harness.options,
  });

  assert.deepEqual(result, { attempts: 1, exitCode: 0, outcome: "passed" });
  assert.deepEqual(harness.calls, [["run", "audit"]]);
  assert.deepEqual(harness.delays, []);
  assert.deepEqual(harness.reports, []);
});

test("retries a 503 response and passes when npm recovers", async () => {
  const harness = createHarness([serviceUnavailable, success]);
  const result = await runSecurityCheck({
    check: "advisories",
    outagePolicy: "warn",
    ...harness.options,
  });

  assert.deepEqual(result, { attempts: 2, exitCode: 0, outcome: "passed" });
  assert.deepEqual(harness.delays, [5_000]);
  assert.equal(harness.calls.length, 2);
  assert.deepEqual(harness.reports, []);
});

test("continues after an exhausted registry outage under the warning policy", async () => {
  const harness = createHarness([serviceUnavailable, serviceUnavailable, serviceUnavailable]);
  const result = await runSecurityCheck({
    check: "advisories",
    outagePolicy: "warn",
    ...harness.options,
  });

  assert.deepEqual(result, { attempts: 3, exitCode: 0, outcome: "inconclusive" });
  assert.deepEqual(harness.delays, [5_000, 15_000]);
  assert.deepEqual(harness.reports, [
    { attempts: 3, check: "advisories", outagePolicy: "warn" },
  ]);
});

test("fails after an exhausted registry outage under the strict policy", async () => {
  const networkTimeout = {
    exitCode: 1,
    stdout: "",
    stderr: "npm error code ETIMEDOUT\nnpm error request to https://registry.npmjs.org failed\n",
  };
  const harness = createHarness([networkTimeout, networkTimeout, networkTimeout]);
  const result = await runSecurityCheck({
    check: "signatures",
    outagePolicy: "fail",
    ...harness.options,
  });

  assert.deepEqual(result, { attempts: 3, exitCode: 1, outcome: "failed" });
  assert.deepEqual(harness.delays, [5_000, 15_000]);
  assert.deepEqual(harness.reports, [
    { attempts: 3, check: "signatures", outagePolicy: "fail" },
  ]);
});

test("fails an advisory finding immediately without retrying", async () => {
  const vulnerability = {
    exitCode: 1,
    stdout: "5 high severity vulnerabilities\n",
    stderr: "",
  };
  const harness = createHarness([vulnerability]);
  const result = await runSecurityCheck({
    check: "advisories",
    outagePolicy: "warn",
    ...harness.options,
  });

  assert.deepEqual(result, { attempts: 1, exitCode: 1, outcome: "failed" });
  assert.deepEqual(harness.delays, []);
  assert.deepEqual(harness.reports, []);
});

test("fails invalid or missing signatures immediately without retrying", async () => {
  const invalidSignature = {
    exitCode: 1,
    stdout: "1 package has an invalid registry signature\n",
    stderr: "npm error Invalid registry signature\n",
  };
  const harness = createHarness([invalidSignature]);
  const result = await runSecurityCheck({
    check: "signatures",
    outagePolicy: "warn",
    ...harness.options,
  });

  assert.deepEqual(result, { attempts: 1, exitCode: 1, outcome: "failed" });
  assert.deepEqual(harness.delays, []);
  assert.deepEqual(harness.reports, []);
});

test("diagnoses and softens a 503 from the signature metadata service", async () => {
  const opaqueDownloadFailure = {
    exitCode: 1,
    stdout: "",
    stderr: "npm error Failed to download\n",
  };
  const verboseServiceUnavailable = {
    exitCode: 1,
    stdout: "",
    stderr:
      "npm verbose type DownloadHTTPError\n" +
      "npm verbose stack DownloadHTTPError: Failed to download\n" +
      "npm verbose statusCode 503\n" +
      "npm error Failed to download\n",
  };
  const harness = createHarness([
    opaqueDownloadFailure,
    verboseServiceUnavailable,
    verboseServiceUnavailable,
  ]);
  const result = await runSecurityCheck({
    check: "signatures",
    outagePolicy: "warn",
    ...harness.options,
  });

  assert.deepEqual(result, { attempts: 3, exitCode: 0, outcome: "inconclusive" });
  assert.deepEqual(harness.executionOptions, [undefined, { logLevel: "verbose" }, { logLevel: "verbose" }]);
  assert.deepEqual(harness.delays, [5_000, 15_000]);
  assert.deepEqual(harness.reports, [
    { attempts: 3, check: "signatures", outagePolicy: "warn" },
  ]);
});

test("fails a revealed 4xx signature metadata response closed", async () => {
  const opaqueDownloadFailure = {
    exitCode: 1,
    stdout: "",
    stderr: "npm error Failed to download\n",
  };
  const verboseForbidden = {
    exitCode: 1,
    stdout: "",
    stderr:
      "npm verbose type DownloadHTTPError\n" +
      "npm verbose statusCode 403\n" +
      "npm error Failed to download\n",
  };
  const harness = createHarness([opaqueDownloadFailure, verboseForbidden]);
  const result = await runSecurityCheck({
    check: "signatures",
    outagePolicy: "warn",
    ...harness.options,
  });

  assert.deepEqual(result, { attempts: 2, exitCode: 1, outcome: "failed" });
  assert.deepEqual(harness.delays, [5_000]);
  assert.deepEqual(harness.reports, []);
});

test("fails authentication and unknown errors closed", async (t) => {
  const failures = [
    {
      name: "authentication failure",
      result: {
        exitCode: 1,
        stdout: "",
        stderr: "npm error code E401\nnpm error Unable to authenticate\n",
      },
    },
    {
      name: "unknown failure",
      result: { exitCode: 2, stdout: "", stderr: "npm error unexpected response\n" },
    },
  ];

  for (const failure of failures) {
    await t.test(failure.name, async () => {
      const harness = createHarness([failure.result]);
      const result = await runSecurityCheck({
        check: "advisories",
        outagePolicy: "warn",
        ...harness.options,
      });

      assert.deepEqual(result, {
        attempts: 1,
        exitCode: failure.result.exitCode,
        outcome: "failed",
      });
      assert.deepEqual(harness.delays, []);
      assert.deepEqual(harness.reports, []);
    });
  }
});

test("recognizes only explicit retryable registry failures", () => {
  assert.equal(isRetryableRegistryFailure(serviceUnavailable.stderr), true);
  assert.equal(isRetryableRegistryFailure("npm warn audit 429 Too Many Requests\n"), true);
  assert.equal(isRetryableRegistryFailure("npm error code E502\n"), true);
  assert.equal(isRetryableRegistryFailure("npm error errno ECONNRESET\n"), true);
  assert.equal(isRetryableRegistryFailure("npm verbose statusCode 503\n"), true);
  assert.equal(
    isRetryableRegistryFailure(
      "npm warn audit network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk\n",
    ),
    true,
  );
  assert.equal(isRetryableRegistryFailure('{"error":{"code":"E503"}}'), true);
  assert.equal(isRetryableRegistryFailure("npm error code E403\n"), false);
  assert.equal(isRetryableRegistryFailure("npm verbose statusCode 403\n"), false);
  assert.equal(isRetryableRegistryFailure("5 high severity vulnerabilities\n"), false);
  assert.equal(isRetryableRegistryFailure("npm error Invalid registry signature\n"), false);
});
