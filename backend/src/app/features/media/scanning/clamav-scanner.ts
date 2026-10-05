import { connect } from "node:net";
import {
  MalwareScannerUnavailableError,
  type MalwareScanner,
  type MalwareScanResult,
} from "@/features/media/scanning/malware-scanner";

export interface ClamAvScannerOptions {
  host: string;
  port: number;
  /** For each request to clamd, from connecting to its whole reply. */
  timeoutMs: number;
  /** Must not exceed clamd's StreamMaxLength, or clamd refuses the stream. */
  maxStreamBytes: number;
  /** For tests. */
  now?: () => number;
}

// clamd reads INSTREAM in chunks of any size; this keeps each write modest.
const CHUNK_BYTES = 64 * 1024;
// A reply is one short line. Anything longer is not clamd.
const MAX_REPLY_BYTES = 4 * 1024;
// The signature database updates a few times a day, so the recorded engine
// follows it within the hour.
const ENGINE_TTL_MS = 60 * 60 * 1000;
// After a failed read, scans record the fallback for this long before one of
// them asks again, so a broken VERSION is not retried on every scan.
const ENGINE_RETRY_MS = 5 * 60 * 1000;
// The engine is only a label, so it waits less than a scan would.
const ENGINE_TIMEOUT_MS = 5_000;
const FALLBACK_ENGINE = "clamav";

/**
 * Scans with a clamd daemon over TCP, using its INSTREAM command: the bytes
 * are streamed in length-prefixed chunks, so nothing is written to disk on
 * either side. Each scan uses its own connection, so concurrent jobs do not
 * share one.
 */
export class ClamAvScanner implements MalwareScanner {
  private engine: { name: string; expiresAt: number } | null = null;
  // The read in flight, shared by every scan that needs the engine meanwhile.
  private engineRead: Promise<string> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: ClamAvScannerOptions) {
    this.now = options.now ?? Date.now;
  }

  async scan(body: Buffer): Promise<MalwareScanResult> {
    if (body.byteLength > this.options.maxStreamBytes) {
      throw new MalwareScannerUnavailableError(
        `The upload is ${body.byteLength} bytes, over the scanner's ${this.options.maxStreamBytes}-byte stream limit.`,
      );
    }

    // The engine is read alongside the scan, so it adds no round trip.
    const [reply, engine] = await Promise.all([
      this.request(buildInstreamFrames(body), this.options.timeoutMs),
      this.readEngine(),
    ]);

    return { ...parseInstreamReply(reply), engine };
  }

  /**
   * clamd's version and signature database, such as "ClamAV 1.5.4/28137".
   * Never rejects: the engine only labels a verdict, so a failed read falls
   * back to a generic name, which is kept for a few minutes before the next
   * read. Concurrent scans share one read.
   */
  private readEngine(): Promise<string> {
    if (this.engine && this.now() < this.engine.expiresAt) {
      return Promise.resolve(this.engine.name);
    }

    this.engineRead ??= this.request(
      [Buffer.from("zVERSION\0")],
      Math.min(this.options.timeoutMs, ENGINE_TIMEOUT_MS),
    )
      .then(parseVersionReply)
      .then(
        (name) => this.cacheEngine(name, ENGINE_TTL_MS),
        () => this.cacheEngine(FALLBACK_ENGINE, ENGINE_RETRY_MS),
      )
      .finally(() => {
        this.engineRead = null;
      });

    return this.engineRead;
  }

  private cacheEngine(name: string, ttlMs: number): string {
    this.engine = { name, expiresAt: this.now() + ttlMs };
    return name;
  }

  /** Sends one command and resolves with clamd's null-terminated reply. */
  private request(frames: Buffer[], timeoutMs: number): Promise<string> {
    const { host, port } = this.options;

    return new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      const received: Buffer[] = [];
      let receivedBytes = 0;
      let settled = false;

      const settle = (complete: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        socket.destroy();
        complete();
      };
      const fail = (message: string, cause?: unknown) =>
        settle(() =>
          reject(new MalwareScannerUnavailableError(message, { cause })),
        );

      const timer = setTimeout(
        () =>
          fail(
            `clamd at ${host}:${port} did not answer within ${timeoutMs} ms.`,
          ),
        timeoutMs,
      );

      socket.on("connect", () => {
        for (const frame of frames) {
          socket.write(frame);
        }
      });
      socket.on("data", (data: Buffer) => {
        received.push(data);
        receivedBytes += data.byteLength;
        const reply = Buffer.concat(received);
        const end = reply.indexOf(0);

        if (end !== -1) {
          settle(() => resolve(reply.subarray(0, end).toString("utf8").trim()));
        } else if (receivedBytes > MAX_REPLY_BYTES) {
          fail(`clamd at ${host}:${port} sent an unterminated reply.`);
        }
      });
      socket.on("error", (error) =>
        fail(`clamd at ${host}:${port} is unavailable.`, error),
      );
      socket.on("close", () =>
        fail(`clamd at ${host}:${port} closed the connection without a reply.`),
      );
    });
  }
}

/**
 * The INSTREAM command, then the body in chunks each prefixed with its length
 * as a 4-byte big-endian integer, then a zero length to end the stream.
 */
export function buildInstreamFrames(
  body: Buffer,
  chunkBytes: number = CHUNK_BYTES,
): Buffer[] {
  const frames: Buffer[] = [Buffer.from("zINSTREAM\0")];

  for (let offset = 0; offset < body.byteLength; offset += chunkBytes) {
    const chunk = body.subarray(offset, offset + chunkBytes);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(chunk.byteLength);
    frames.push(length, chunk);
  }

  frames.push(Buffer.alloc(4));
  return frames;
}

/**
 * `stream: OK` is clean and `stream: <signature> FOUND` infected. Anything
 * else, such as `INSTREAM size limit exceeded. ERROR`, is no verdict at all.
 */
export function parseInstreamReply(
  reply: string,
): Pick<MalwareScanResult, "verdict" | "threat"> {
  if (reply === "stream: OK") {
    return { verdict: "clean" };
  }

  const found = /^stream: (.+) FOUND$/.exec(reply);

  if (found) {
    return { verdict: "infected", threat: found[1] };
  }

  throw new MalwareScannerUnavailableError(
    `clamd could not scan the upload: ${reply.slice(0, 200)}`,
  );
}

/**
 * Keeps the version and the signature database's version from a reply such
 * as `ClamAV 1.5.4/28137/Mon Sep 28 06:24:12 2026`; the date adds nothing.
 */
export function parseVersionReply(reply: string): string {
  if (!reply.startsWith("ClamAV ")) {
    throw new MalwareScannerUnavailableError(
      `clamd sent an unexpected version: ${reply.slice(0, 200)}`,
    );
  }

  return reply.split("/").slice(0, 2).join("/");
}
