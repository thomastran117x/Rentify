import { loadEnvironment } from "@/configuration/environment";
import {
  connectDatabase,
  disconnectDatabase,
} from "@/configuration/resources/database";
import { disconnectLogging } from "@/configuration/logging";
import { BlobService } from "@/features/blob/blob.service";
import { MediaRepository } from "@/features/media/media.repository";
import {
  DEFAULT_BACKFILL_BATCH_SIZE,
  mediaVariantsBackfillExitCode,
  MediaVariantsBackfillService,
} from "@/features/media/media-variants-backfill.service";

const MAX_BATCH_SIZE = 500;

type BackfillCliOptions = {
  dryRun: boolean;
  batchSize: number;
  showHelp: boolean;
};

function parseBackfillArgs(args: string[]): BackfillCliOptions {
  const options: BackfillCliOptions = {
    dryRun: false,
    batchSize: DEFAULT_BACKFILL_BATCH_SIZE,
    showHelp: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;

    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      options.showHelp = true;
    } else if (
      argument === "--batch-size" ||
      argument.startsWith("--batch-size=")
    ) {
      const value = argument.includes("=")
        ? argument.slice("--batch-size=".length)
        : args[++index];
      const batchSize = Number(value);

      if (
        !Number.isInteger(batchSize) ||
        batchSize < 1 ||
        batchSize > MAX_BATCH_SIZE
      ) {
        throw new Error(
          `--batch-size must be a whole number from 1 to ${MAX_BATCH_SIZE}.`,
        );
      }

      options.batchSize = batchSize;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: docker compose run --rm --build media-variants-backfill [--dry-run] [--batch-size <n>]",
      "",
      "Writes the medium and thumbnail renditions of ready media processed before renditions existed,",
      "from their stored processed image, and records them on the media row. Safe to re-run.",
      "",
      "Options:",
      "  --dry-run         List what would be converted. Nothing is written.",
      `  --batch-size <n>  Rows read per query (default ${DEFAULT_BACKFILL_BATCH_SIZE}, at most ${MAX_BATCH_SIZE}).`,
      "  --help            Show this help message.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const options = parseBackfillArgs(process.argv.slice(2));

  if (options.showHelp) {
    printHelp();
    return;
  }

  loadEnvironment();
  await connectDatabase();

  try {
    const backfill = new MediaVariantsBackfillService(
      new MediaRepository(),
      new BlobService(),
    );
    const result = await backfill.run(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = mediaVariantsBackfillExitCode(result);
  } finally {
    await Promise.allSettled([disconnectDatabase(), disconnectLogging()]);
  }
}

void main().catch(async (error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown backfill error.";
  process.stderr.write(`Media variants backfill failed: ${message}\n`);
  process.exitCode = 1;
  await Promise.allSettled([disconnectDatabase(), disconnectLogging()]);
});
