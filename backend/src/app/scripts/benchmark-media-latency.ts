/**
 * Measures how long an uploaded image takes from "picked" to "ready" against a
 * running stack, the way the browser's `uploadImage` sees it, and optionally
 * how long each worker stage took. A development tool: it is run with tsx
 * from a checkout, never built into the image.
 *
 *   npm run bench:media-latency -- [options]
 *
 * --api <url>            API base (default http://127.0.0.1:8040/api/v1)
 * --username <name>      seeded user to sign in as (default owner-one)
 * --password <secret>    its password (default Rentify123!)
 * --images <list>        comma-separated reference images (default all):
 *                        small, 12mp, 40mp, near-limit
 * --runs <n>             uploads per image, one at a time (default 20)
 * --burst <n>            instead, upload n copies of --burst-image at once
 * --burst-image <name>   the image a burst uploads (default 12mp)
 * --poll-interval <ms>   how often to check the status (default 50, or 500
 *                        in a burst), well under the browser's schedule, to
 *                        find when the item really finished. Each item's
 *                        GET /media/{id} is limited to 60 a minute, which a
 *                        burst's longer waits would exceed at 50 ms
 * --worker-logs          also read the stage timings the worker logged, from
 *                        `docker compose logs`
 * --cache-dir <dir>      where the generated images are kept between runs
 * --prepare              only generate the reference images and describe them
 *
 * The reference images are generated deterministically, so two runs compare
 * like with like. Each upload is deleted once measured, so nothing is left in
 * storage. Sign-in uses the development captcha bypass, so this only works
 * against a development stack.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp, { type Sharp } from "sharp";

interface Options {
  api: string;
  username: string;
  password: string;
  images: ReferenceImageName[];
  runs: number;
  burst: number;
  burstImage: ReferenceImageName;
  pollIntervalMs: number;
  workerLogs: boolean;
  prepare: boolean;
  cacheDir: string;
}

const REFERENCE_IMAGES = {
  small: {
    width: 1600,
    height: 1200,
    format: "jpeg",
    cell: 40,
    grain: 6,
    targetBytes: 250_000,
  },
  "12mp": {
    width: 4000,
    height: 3000,
    format: "jpeg",
    cell: 48,
    grain: 22,
    targetBytes: 3_600_000,
  },
  // At the pixel limit, and flat enough to stay under the size limit as a
  // PNG: the decode is what costs, not the transfer.
  "40mp": {
    width: 8000,
    height: 5000,
    format: "png",
    cell: 64,
    grain: 0,
    targetBytes: 5_000_000,
  },
  // Just under the 5 MiB upload limit.
  "near-limit": {
    width: 5000,
    height: 4000,
    format: "jpeg",
    cell: 48,
    grain: 26,
    targetBytes: 5_100_000,
  },
} as const;

type ReferenceImageName = keyof typeof REFERENCE_IMAGES;

interface ReferenceImage {
  name: ReferenceImageName;
  body: Buffer;
  contentType: string;
  filename: string;
  width: number;
  height: number;
}

interface UploadTiming {
  uploadMs: number;
  waitMs: number;
  totalMs: number;
  status: string;
}

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const next = argv[index + 1];

    if (next === undefined || next.startsWith("--")) {
      flags.add(arg.slice(2));
    } else {
      values.set(arg.slice(2), next);
      index += 1;
    }
  }

  const imageNames = (
    values.get("images") ?? Object.keys(REFERENCE_IMAGES).join(",")
  ).split(",");

  for (const name of [...imageNames, values.get("burst-image") ?? "12mp"]) {
    if (!(name in REFERENCE_IMAGES)) {
      throw new Error(`Unknown reference image: ${name}`);
    }
  }

  return {
    api: values.get("api") ?? "http://127.0.0.1:8040/api/v1",
    username: values.get("username") ?? "owner-one",
    password: values.get("password") ?? "Rentify123!",
    images: imageNames as ReferenceImageName[],
    runs: Number(values.get("runs") ?? 20),
    burst: Number(values.get("burst") ?? 0),
    burstImage: (values.get("burst-image") ?? "12mp") as ReferenceImageName,
    pollIntervalMs: Number(
      values.get("poll-interval") ?? (values.has("burst") ? 500 : 50),
    ),
    workerLogs: flags.has("worker-logs"),
    prepare: flags.has("prepare"),
    cacheDir:
      values.get("cache-dir") ?? path.join(tmpdir(), "rent-media-benchmark"),
  };
}

/** A small seeded generator, so the same image comes out every time. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Soft colour fields scaled up from a coarse random grid, with per-pixel grain
 * on top: enough detail that JPEG sizes land where a camera photo's do.
 */
async function texture(
  width: number,
  height: number,
  cell: number,
  grain: number,
  seed: number,
): Promise<Sharp> {
  const random = mulberry32(seed);
  const coarseWidth = Math.ceil(width / cell);
  const coarseHeight = Math.ceil(height / cell);
  const coarse = Buffer.alloc(coarseWidth * coarseHeight * 3);

  for (let index = 0; index < coarse.length; index += 1) {
    coarse[index] = Math.floor(random() * 256);
  }

  const pixels = await sharp(coarse, {
    raw: { width: coarseWidth, height: coarseHeight, channels: 3 },
  })
    .resize(width, height, {
      fit: "fill",
      kernel: grain > 0 ? "cubic" : "nearest",
    })
    .raw()
    .toBuffer();

  for (let index = 0; grain > 0 && index < pixels.length; index += 1) {
    const value = pixels[index]! + (random() - 0.5) * 2 * grain;
    pixels[index] = value < 0 ? 0 : value > 255 ? 255 : value;
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

/** The highest JPEG quality whose output fits `targetBytes`. */
async function encodeJpegNear(
  source: Sharp,
  targetBytes: number,
): Promise<Buffer> {
  let low = 40;
  let high = 95;
  let best = await source.clone().jpeg({ quality: low }).toBuffer();

  while (low <= high) {
    const quality = Math.floor((low + high) / 2);
    const encoded = await source.clone().jpeg({ quality }).toBuffer();

    if (encoded.byteLength <= targetBytes) {
      best = encoded;
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }

  return best;
}

async function loadReferenceImage(
  name: ReferenceImageName,
  cacheDir: string,
): Promise<ReferenceImage> {
  const spec = REFERENCE_IMAGES[name];
  const filename = `${name}.${spec.format === "png" ? "png" : "jpg"}`;
  const file = path.join(cacheDir, filename);
  let body: Buffer;

  try {
    await stat(file);
    body = await readFile(file);
  } catch {
    const source = await texture(
      spec.width,
      spec.height,
      spec.cell,
      spec.grain,
      spec.width * 31 + spec.height,
    );
    body =
      spec.format === "png"
        ? await source
            .png({ compressionLevel: 9, adaptiveFiltering: true })
            .toBuffer()
        : await encodeJpegNear(source, spec.targetBytes);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, body);
  }

  return {
    name,
    body,
    filename,
    contentType: spec.format === "png" ? "image/png" : "image/jpeg",
    width: spec.width,
    height: spec.height,
  };
}

class Api {
  private token: string | null = null;

  constructor(private readonly options: Options) {}

  private async signIn(): Promise<string> {
    const response = await fetch(`${this.options.api}/auth/local/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: this.options.username,
        password: this.options.password,
        captchaToken: "local-dev-bypass",
      }),
    });

    if (!response.ok) {
      throw new Error(`Sign-in failed with ${response.status}.`);
    }

    const body = (await response.json()) as { data: { accessToken: string } };
    this.token = body.data.accessToken;
    return this.token;
  }

  /** One JSON call, signing in again once if the token has expired. */
  async json<T>(
    method: string,
    route: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const token = this.token ?? (await this.signIn());
      const response = await fetch(`${this.options.api}${route}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      if (response.status === 401 && attempt === 0) {
        this.token = null;
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `${method} ${route} failed with ${response.status}: ${await response.text()}`,
        );
      }

      return ((await response.json()) as { data: T }).data;
    }
  }
}

interface MediaView {
  id: string;
  status: string;
  rejectionReason: string | null;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What `uploadImage` does, timed the same way. */
async function uploadOnce(
  api: Api,
  image: ReferenceImage,
  options: Options,
): Promise<UploadTiming> {
  const startedAt = performance.now();
  const { mediaId, upload } = await api.json<{
    mediaId: string;
    upload: { method: string; url: string; headers: Record<string, string> };
  }>("POST", "/media/uploads", {
    filename: image.filename,
    contentType: image.contentType,
    sizeBytes: image.body.byteLength,
    scope: "postings",
  });

  try {
    const put = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: new Uint8Array(image.body),
    });

    if (!put.ok) {
      throw new Error(`PUT failed with ${put.status}.`);
    }

    const uploadMs = performance.now() - startedAt;
    const waitStartedAt = performance.now();
    let media = (
      await api.json<{ media: MediaView }>("POST", `/media/${mediaId}/complete`)
    ).media;

    while (media.status !== "ready" && media.status !== "rejected") {
      if (performance.now() - waitStartedAt > 120_000) {
        throw new Error(`${mediaId} did not finish within 2 minutes.`);
      }

      await sleep(options.pollIntervalMs);
      const timing = `upload=${Math.round(uploadMs)}, wait=${Math.round(
        performance.now() - waitStartedAt,
      )}, via=poll`;
      media = (
        await api.json<{ media: MediaView }>(
          "GET",
          `/media/${mediaId}`,
          undefined,
          { "x-media-upload-timing": timing },
        )
      ).media;
    }

    const finishedAt = performance.now();

    if (media.status === "rejected") {
      console.warn(`  ${image.name}: rejected: ${media.rejectionReason}`);
    }

    return {
      uploadMs,
      waitMs: finishedAt - waitStartedAt,
      totalMs: finishedAt - startedAt,
      status: media.status,
    };
  } finally {
    await api
      .json("DELETE", `/media/${mediaId}`)
      .catch((error: unknown) =>
        console.warn(`  could not delete ${mediaId}: ${String(error)}`),
      );
  }
}

/** Nearest-rank percentile of an already sorted list. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return NaN;
  }

  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

function summarize(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const format = (value: number) =>
    Number.isNaN(value) ? "-" : `${Math.round(value)}`;

  return `${format(percentile(sorted, 0.5))} | ${format(percentile(sorted, 0.95))} | ${format(sorted.at(-1) ?? NaN)}`;
}

interface LoggedMetric {
  metric: string;
  value: number;
  tags: Record<string, string>;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const METRIC_LINE =
  /media\.metric .*?metric=(\S+) .*?value=(\S+) .*?tags=(\{.*\})/;

/** The media metrics a compose service logged in a window. */
function readLoggedMetrics(
  service: string,
  since: Date,
  until: Date,
): LoggedMetric[] {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "logs",
      "--no-log-prefix",
      "--since",
      since.toISOString(),
      "--until",
      until.toISOString(),
      service,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const metrics: LoggedMetric[] = [];

  for (const line of output.split("\n")) {
    const match = METRIC_LINE.exec(line.replace(ANSI, ""));

    if (match) {
      metrics.push({
        metric: match[1]!,
        value: Number(match[2]),
        tags: JSON.parse(match[3]!) as Record<string, string>,
      });
    }
  }

  return metrics;
}

const STAGES = [
  "download",
  "scan",
  "inspect",
  "render",
  "renditions",
  "moderate",
  "upload",
  "mark_ready",
];

function printWorkerTimings(label: string, since: Date, until: Date): void {
  const worker = readLoggedMetrics("media-processing-worker", since, until);
  const api = readLoggedMetrics("backend", since, until);
  const valuesOf = (
    metrics: LoggedMetric[],
    name: string,
    filter: (tags: Record<string, string>) => boolean = () => true,
  ) =>
    metrics
      .filter((metric) => metric.metric === name && filter(metric.tags))
      .map((metric) => metric.value);

  console.log(`\n${label}: server-side timings (ms)\n`);
  console.log("| Metric | n | p50 | p95 | max |");
  console.log("| --- | --- | --- | --- | --- |");

  const rows: Array<[string, number[]]> = [
    ["queue wait", valuesOf(worker, "media.processing.queue_wait")],
    ...STAGES.map((stage): [string, number[]] => [
      `stage: ${stage}`,
      valuesOf(
        worker,
        "media.processing.stage.duration",
        (tags) => tags.stage === stage,
      ),
    ]),
    [
      "processing (whole attempt)",
      valuesOf(worker, "media.processing.duration"),
    ],
    ["client notice delay", valuesOf(api, "media.client.notice.delay")],
  ];

  for (const [name, values] of rows) {
    if (values.length > 0) {
      console.log(`| ${name} | ${values.length} | ${summarize(values)} |`);
    }
  }
}

function printClientTimings(label: string, timings: UploadTiming[]): void {
  const failed = timings.filter((timing) => timing.status !== "ready").length;

  console.log(
    `\n${label}: client-observed timings (ms), ${timings.length} uploads${
      failed ? `, ${failed} not ready` : ""
    }\n`,
  );
  console.log("| Phase | p50 | p95 | max |");
  console.log("| --- | --- | --- | --- |");
  console.log(`| upload | ${summarize(timings.map((t) => t.uploadMs))} |`);
  console.log(`| wait | ${summarize(timings.map((t) => t.waitMs))} |`);
  console.log(`| total | ${summarize(timings.map((t) => t.totalMs))} |`);
}

/** Lets the worker's trailing log lines land before they are read. */
const LOG_SETTLE_MS = 3_000;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const api = new Api(options);
  const names = options.burst > 0 ? [options.burstImage] : options.images;
  const images = [];

  for (const name of names) {
    const image = await loadReferenceImage(name, options.cacheDir);
    const { width, height, format } = await sharp(image.body).metadata();
    console.log(
      `${name}: ${width}x${height} ${format}, ${(image.body.byteLength / 1_048_576).toFixed(2)} MiB`,
    );
    images.push(image);
  }

  if (options.prepare) {
    return;
  }

  if (options.burst > 0) {
    const image = images[0]!;
    // One upload first, so sign-in and connection setup are not in the burst.
    await uploadOnce(api, image, options);
    const since = new Date();
    const startedAt = performance.now();
    const timings = await Promise.all(
      Array.from({ length: options.burst }, () =>
        uploadOnce(api, image, options),
      ),
    );
    const wallMs = performance.now() - startedAt;
    const label = `burst of ${options.burst} x ${image.name}`;

    printClientTimings(label, timings);
    console.log(`\nwall time: ${Math.round(wallMs)} ms`);

    if (options.workerLogs) {
      await sleep(LOG_SETTLE_MS);
      printWorkerTimings(label, since, new Date());
    }

    return;
  }

  for (const image of images) {
    // A warm-up upload, not counted.
    await uploadOnce(api, image, options);
    const since = new Date();
    const timings: UploadTiming[] = [];

    for (let run = 0; run < options.runs; run += 1) {
      timings.push(await uploadOnce(api, image, options));
    }

    printClientTimings(image.name, timings);

    if (options.workerLogs) {
      await sleep(LOG_SETTLE_MS);
      printWorkerTimings(image.name, since, new Date());
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
