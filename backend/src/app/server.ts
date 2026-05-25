import { serve } from "@hono/node-server";
import {
  disconnectApplicationResources,
  initializeServerApplication,
} from "@/configuration/bootstrap/startup";
import { disconnectLogging, loggerFactory } from "@/configuration/logging";

const serverLogger = loggerFactory.forComponent("server", "app");

async function bootstrap(): Promise<void> {
  const { app, port } = await initializeServerApplication();

  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname: "0.0.0.0",
    },
    () => {
      serverLogger.info("Server listening.", {
        hostname: "0.0.0.0",
        port,
      });
    },
  );

  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    serverLogger.info("Server shutdown requested.", {
      signal,
    });

    server.close();
    await Promise.allSettled([
      disconnectApplicationResources(),
      disconnectLogging(),
    ]);
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void bootstrap().catch(async (error: unknown) => {
  serverLogger.critical("Failed to start server.", undefined, error);
  await Promise.allSettled([
    disconnectApplicationResources(),
    disconnectLogging(),
  ]);
  process.exit(1);
});
