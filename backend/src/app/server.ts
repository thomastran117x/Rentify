import { serve } from "@hono/node-server";
import {
  disconnectApplicationResources,
  initializeServerApplication,
} from "@/configuration/bootstrap/startup";
import { disconnectLogging, loggerFactory } from "@/configuration/logging";
import { getContainer } from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";

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

  // Attached to the Node server rather than routed through Hono: the
  // @hono/node-ws adapter peers on @hono/node-server 1.x and this app runs 2.x.
  getContainer()
    .resolve(containerTokens.bookingMessageSocketServer)
    .attach(server as unknown as import("node:http").Server);

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
