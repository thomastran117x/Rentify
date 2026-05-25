import { loadEnvironment } from "@/configuration/environment";
import { disconnectLogging, loggerFactory } from "@/configuration/logging";
import {
  connectDatabase,
  disconnectDatabase,
} from "@/configuration/resources/database";
import { runSeedOrchestrator } from "@/seeds";

type SeedCliOptions = {
  onlyIfEmpty: boolean;
  refresh: boolean;
  showHelp: boolean;
};

const seedScriptLogger = loggerFactory.forComponent("seed-script", "script");

function parseArgs(args: string[]): SeedCliOptions {
  return {
    onlyIfEmpty: args.includes("--only-if-empty"),
    refresh: args.includes("--refresh"),
    showHelp: args.includes("--help") || args.includes("-h"),
  };
}

function printHelp(): void {
  seedScriptLogger.info(
    [
      "Usage: npm run seed -- [--refresh] [--only-if-empty]",
      "",
      "Options:",
      "  --refresh        Reapply fixture-owned data even when the database is already populated.",
      "  --only-if-empty  Skip the run unless the database has zero users.",
      "  --help           Show this help message.",
    ].join("\n"),
  );
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
    await runSeedOrchestrator({
      onlyIfEmpty: options.onlyIfEmpty,
      refresh: options.refresh,
      source: "script",
    });
  } finally {
    await Promise.allSettled([disconnectDatabase(), disconnectLogging()]);
  }
}

void main().catch(async (error: unknown) => {
  seedScriptLogger.critical(
    "Failed to run seed orchestrator.",
    undefined,
    error,
  );
  await Promise.allSettled([disconnectDatabase(), disconnectLogging()]);
  process.exit(1);
});
