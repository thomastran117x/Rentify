import {
  disconnectLogging,
  ApplicationLogQueueService,
  type LogEvent,
} from "@/configuration/logging";
import { formatPrettyLogEvent } from "@/configuration/logging/pretty";
import {
  disconnectResources,
  rabbitMqWorkerResource,
} from "@/workers/shared/resources";
import { bootstrapWorker, startWorker } from "@/workers/shared/worker-runtime";

const workerName = "Application log consumer worker";
const workerResources = [rabbitMqWorkerResource];
const logQueueService = new ApplicationLogQueueService();

export async function bootstrapLogConsumerWorker(): Promise<void> {
  await bootstrapWorker({
    name: workerName,
    resources: workerResources,
    run: async (_context, lifecycle) => {
      await logQueueService.ensureTopology();
      const stopConsuming = await logQueueService.consumeLogEvents(
        100,
        async (event, message, channel) => {
          try {
            await processLogEvent(event);
            channel.ack(message);
          } catch (error) {
            await writeDirectFailureLine(
              `[LOG CONSUMER FAILURE] queue=application-logs.main worker=${workerName} error=${formatUnknownError(error)}`,
            );
            channel.nack(message, false, true);
          }
        },
      );

      lifecycle.addShutdownTask(async () => {
        await Promise.allSettled([
          stopConsuming(),
          logQueueService.disconnect(),
          disconnectLogging(),
        ]);
      });
    },
  });
}

async function writeDirectFailureLine(line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stderr.write(`${line}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function processLogEvent(event: LogEvent): Promise<void> {
  const stream =
    event.level === "error" || event.level === "critical"
      ? process.stderr
      : process.stdout;

  await new Promise<void>((resolve, reject) => {
    stream.write(`${formatPrettyLogEvent(event)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapLogConsumerWorker,
  cleanup: async () => {
    await Promise.allSettled([
      disconnectResources(workerResources),
      logQueueService.disconnect(),
      disconnectLogging(),
    ]);
  },
});
