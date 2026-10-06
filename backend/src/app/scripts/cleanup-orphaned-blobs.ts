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
import { checkBlobStorageAccess } from "@/features/blob/blob-storage-access";

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
      "Compares both Azure Blob Storage containers (public and quarantine) with the current MySQL database.",
      "Only unreferenced image/* blobs, and quarantined uploads, at least 24 hours old are candidates.",
      "Each candidate is deleted from the container it was found in, so quarantine/ leftovers in the public container are removed too.",
      "An upload still waiting on processing, or kept by a processing failure for a replay, never is.",
      "With --delete, the media records of deleted blobs are removed too; media-cleanup-worker handles unfinished media.",
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
  await checkBlobStorageAccess();
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
