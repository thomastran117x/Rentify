import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const CHECKS = Object.freeze({
  advisories: {
    args: ["run", "audit"],
    label: "dependency advisory audit",
  },
  signatures: {
    args: ["run", "audit:signatures"],
    label: "registry signature verification",
  },
});

const OUTAGE_POLICIES = new Set(["warn", "fail"]);
const RETRY_DELAYS_MS = Object.freeze([5_000, 15_000]);
const NPM_FETCH_TIMEOUT_MS = 30_000;

const RETRYABLE_REGISTRY_PATTERNS = [
  /^npm (?:warn|error)\s+(?:audit\s+)?(?:HTTP\s+)?(?:429|5\d{2})\b/im,
  /^npm error\s+code\s+E(?:429|5\d{2})\b/im,
  /^npm error\s+(?:code|errno)\s+(?:EAI_AGAIN|ECONNABORTED|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ERR_SOCKET_TIMEOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_SOCKET)\b/im,
  /^npm (?:warn|error)\s+audit\s+network timeout at:\s+https?:\/\//im,
  /"code"\s*:\s*"E(?:429|5\d{2})"/i,
];

export function isRetryableRegistryFailure(output) {
  return RETRYABLE_REGISTRY_PATTERNS.some((pattern) => pattern.test(output));
}

function executeNpm(args) {
  const npmCli =
    process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const executable = process.platform === "win32" ? process.execPath : "npm";
  const commandArgs = process.platform === "win32" ? [npmCli, ...args] : args;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, commandArgs, {
        env: {
          ...process.env,
          npm_config_fetch_retries: "0",
          npm_config_fetch_timeout: String(NPM_FETCH_TIMEOUT_MS),
        },
        shell: false,
      });
    } catch (error) {
      const code = typeof error.code === "string" ? `npm error code ${error.code}\n` : "";
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: `${code}npm error ${error.message}\n`,
      });
      return;
    }
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      const code = typeof error.code === "string" ? `npm error code ${error.code}\n` : "";
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${code}npm error ${error.message}\n`,
      });
    });
    child.on("close", (exitCode) => {
      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function escapeWorkflowCommandData(value) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

async function reportOutage({ check, outagePolicy, attempts }) {
  const { label } = CHECKS[check];
  const workspace = process.cwd().split(/[\\/]/).at(-1);
  const continues = outagePolicy === "warn";
  const message = `npm registry availability prevented the ${label} from completing after ${attempts} attempts in ${workspace}. ${continues ? "The workflow will continue under the PR/push outage policy." : "The workflow will fail under the scheduled/manual outage policy."}`;

  if (process.env.GITHUB_ACTIONS === "true") {
    const annotation = continues ? "warning" : "error";
    process.stderr.write(
      `::${annotation} title=npm security check unavailable::${escapeWorkflowCommandData(message)}\n`,
    );
  } else {
    process.stderr.write(`${continues ? "WARNING" : "ERROR"}: ${message}\n`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const heading = continues ? "npm security check inconclusive" : "npm security check unavailable";
    try {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${heading}\n\n${message}\n`);
    } catch (error) {
      process.stderr.write(`Unable to append the npm outage notice to the step summary: ${error.message}\n`);
    }
  }
}

function validateOptions(check, outagePolicy) {
  if (!(check in CHECKS)) {
    throw new TypeError(`Unknown check "${check}". Expected one of: ${Object.keys(CHECKS).join(", ")}.`);
  }
  if (!OUTAGE_POLICIES.has(outagePolicy)) {
    throw new TypeError(
      `Unknown outage policy "${outagePolicy}". Expected one of: ${[...OUTAGE_POLICIES].join(", ")}.`,
    );
  }
}

export async function runSecurityCheck({
  check,
  outagePolicy,
  execute = executeNpm,
  wait = sleep,
  report = reportOutage,
  stdout = process.stdout,
  stderr = process.stderr,
  retryDelaysMs = RETRY_DELAYS_MS,
}) {
  validateOptions(check, outagePolicy);
  const { args, label } = CHECKS[check];
  const maximumAttempts = retryDelaysMs.length + 1;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const result = await execute(args);
    stdout.write(result.stdout);
    stderr.write(result.stderr);

    if (result.exitCode === 0) {
      return { attempts: attempt, exitCode: 0, outcome: "passed" };
    }

    const output = `${result.stdout}\n${result.stderr}`;
    if (!isRetryableRegistryFailure(output)) {
      return { attempts: attempt, exitCode: result.exitCode || 1, outcome: "failed" };
    }

    if (attempt < maximumAttempts) {
      const delay = retryDelaysMs[attempt - 1];
      stderr.write(
        `npm registry unavailable during ${label}; retrying in ${delay / 1_000} seconds (attempt ${attempt + 1}/${maximumAttempts}).\n`,
      );
      await wait(delay);
      continue;
    }

    await report({ attempts: attempt, check, outagePolicy });
    return {
      attempts: attempt,
      exitCode: outagePolicy === "warn" ? 0 : result.exitCode || 1,
      outcome: outagePolicy === "warn" ? "inconclusive" : "failed",
    };
  }

  throw new Error("The npm security check exhausted its attempts without producing a result.");
}

async function main() {
  const [, , check, outagePolicy] = process.argv;
  try {
    const result = await runSecurityCheck({ check, outagePolicy });
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    if (error instanceof TypeError) {
      process.stderr.write(
        "Usage: node scripts/npm-security-check.mjs <advisories|signatures> <warn|fail>\n",
      );
      process.exitCode = 2;
    } else {
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
