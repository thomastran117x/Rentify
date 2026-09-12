import { loadEnvironment } from "@/configuration/environment";
import {
  connectDatabase,
  disconnectDatabase,
} from "@/configuration/resources/database";
import { disconnectLogging } from "@/configuration/logging";
import { BlobCleanupRepository } from "@/features/blob/blob-cleanup.repository";
import {
  blobCleanupExitCode,
  BlobCleanupService,
} from "@/features/blob/blob-cleanup.service";
import { BlobService } from "@/features/blob/blob.service";

type CliOptions = {
  deleteCandidates: boolean;
  showHelp: boolean;
};

function parseArgs(args: string[]): CliOptions {
  const supported = new Set(["--delete", "--help", "-h"]);
  const unknown = args.filter((argument) => !supported.has(argument));

  if (unknown.length > 0) {
    throw new Error(`Unknown option(s): ${unknown.join(", ")}`);
  }

  return {
    deleteCandidates: args.includes("--delete"),
    showHelp: args.includes("--help") || args.includes("-h"),
  };
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: docker compose run --rm --build blob-cleanup [--delete]",
      "",
      "Compares Azure Blob Storage with the current MySQL database.",
      "Only unreferenced image/* blobs at least 24 hours old are candidates.",
      "",
      "Options:",
      "  --delete  Delete candidates. Without this flag the command is preview-only.",
      "  --help    Show this help message.",
      "",
    ].join("\n"),
  );
}

function printResult(
  result: Awaited<ReturnType<BlobCleanupService["run"]>>,
): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.showHelp) {
    printHelp();
    return;
  }

  loadEnvironment();
  await connectDatabase();

  try {
    const cleanupService = new BlobCleanupService(
      new BlobCleanupRepository(),
      new BlobService(),
    );
    const result = await cleanupService.run(options.deleteCandidates);
    printResult(result);
    process.exitCode = blobCleanupExitCode(result);
  } finally {
    await Promise.allSettled([disconnectDatabase(), disconnectLogging()]);
  }
}

void main().catch(async (error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown cleanup error.";
  process.stderr.write(`Blob cleanup failed: ${message}\n`);
  process.exitCode = 1;
  await Promise.allSettled([disconnectDatabase(), disconnectLogging()]);
});
