import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BROWSER_POLL_DELAYS_MS,
  BROWSER_PUSH_FALLBACK_DELAYS_MS,
} from "@/scripts/media-latency-browser-schedules";

/**
 * The benchmark's copies of the browser's status-check schedules must match
 * `uploadImage`, or `--notify poll|push` measures a schedule no browser runs.
 */
const FRONTEND_UPLOAD_SOURCE = path.resolve(
  __dirname,
  "../../../../frontend/src/lib/media/api.ts",
);

function frontendSchedule(name: string): number[] {
  const source = readFileSync(FRONTEND_UPLOAD_SOURCE, "utf8");
  const match = new RegExp(`const ${name} = \\[([^\\]]*)\\];`).exec(source);

  if (!match) {
    throw new Error(`${name} was not found in ${FRONTEND_UPLOAD_SOURCE}.`);
  }

  return match[1]!
    .split(",")
    .map((value) => Number(value.replace(/_/g, "").trim()));
}

describe("the benchmark's browser schedules", () => {
  it("match uploadImage's polling schedule", () => {
    expect(BROWSER_POLL_DELAYS_MS).toEqual(
      frontendSchedule("DEFAULT_POLL_DELAYS_MS"),
    );
  });

  it("match uploadImage's fallback schedule behind a listening socket", () => {
    expect(BROWSER_PUSH_FALLBACK_DELAYS_MS).toEqual(
      frontendSchedule("PUSH_FALLBACK_DELAYS_MS"),
    );
  });
});
