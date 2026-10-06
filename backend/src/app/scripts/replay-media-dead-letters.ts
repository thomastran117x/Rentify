import { environment, loadEnvironment } from "@/configuration/environment";
import {
  connectDatabase,
  disconnectDatabase,
} from "@/configuration/resources/database";
import {
  connectRabbitMq,
  disconnectRabbitMq,
} from "@/configuration/resources/rabbitmq";
import { disconnectLogging } from "@/configuration/logging";
import { BlobService } from "@/features/blob/blob.service";
import { checkBlobStorageAccess } from "@/features/blob/blob-storage-access";
import { MediaRepository } from "@/features/media/media.repository";
import { MediaProcessingQueueService } from "@/features/media/media-processing.queue.service";
import {
  DEFAULT_REPLAY_LIMIT,
  mediaDeadLetterReplayExitCode,
  MediaDeadLetterReplayService,
} from "@/features/media/media-dead-letter-replay.service";

const MAX_LIMIT = 100_000;

type ReplayCliOptions = {
  dryRun: boolean;
  fromDatabase: boolean;
  limit: number;
  showHelp: boolean;
};

function parseReplayArgs(args: string[]): ReplayCliOptions {
  const options: ReplayCliOptions = {
    dryRun: false,
    fromDatabase: false,
    limit: DEFAULT_REPLAY_LIMIT,
    showHelp: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;

    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--from-database") {
      options.fromDatabase = true;
    } else if (argument === "--help" || argument === "-h") {
      options.showHelp = true;
    } else if (argument === "--limit" || argument.startsWith("--limit=")) {
      const value = argument.includes("=")
        ? argument.slice("--limit=".length)
        : args[++index];
      const limit = Number(value);

      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new Error(
          `--limit must be a whole number from 1 to ${MAX_LIMIT}.`,
        );
      }

      options.limit = limit;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: docker compose run --rm --build media-dead-letter-replay [--dry-run] [--from-database] [--limit <n>]",
      "",
      "Replays media processing jobs from media.processing.dead-letter once the outage that",
      "exhausted their retries is over. An item rejected as processing_failed whose upload is",
      "still kept, or one still waiting because rejecting it failed too, is queued again with",
      "attempt 0. Other messages are removed and reported. Only the messages ready when the run",
      "starts are taken. Prints a JSON summary.",
      "",
      "Options:",
      "  --dry-run        Report what a replay would do. Nothing is written; every message stays queued.",
      "  --from-database  Replay every processing_failed item still within the rejected retention whose",
      "                   upload is kept, whether or not its job reached the dead-letter queue.",
      `  --limit <n>      Messages or items to take in one run (default ${DEFAULT_REPLAY_LIMIT}, at most ${MAX_LIMIT}).`,
      "  --help           Show this help message.",
      "",
    ].join("\n"),
  );
}

async function disconnect(): Promise<void> {
  await Promise.allSettled([
    disconnectRabbitMq(),
    disconnectDatabase(),
    disconnectLogging(),
  ]);
}

async function main(): Promise<void> {
  const options = parseReplayArgs(process.argv.slice(2));

  if (options.showHelp) {
    printHelp();
    return;
  }

  loadEnvironment();
  await checkBlobStorageAccess();
  await connectDatabase();
  await connectRabbitMq();

  try {
    const replay = new MediaDeadLetterReplayService(
      new MediaRepository(),
      new BlobService(),
      new MediaProcessingQueueService(),
      {
        rejectedRetentionMs:
          environment.getMediaCleanupWorkerConfig().rejectedRetentionMs,
      },
    );
    const result = await replay.run({
      dryRun: options.dryRun,
      limit: options.limit,
      source: options.fromDatabase ? "database" : "queue",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = mediaDeadLetterReplayExitCode(result);
  } finally {
    await disconnect();
  }
}

void main().catch(async (error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown replay error.";
  process.stderr.write(`Media dead-letter replay failed: ${message}\n`);
  process.exitCode = 1;
  await disconnect();
});
