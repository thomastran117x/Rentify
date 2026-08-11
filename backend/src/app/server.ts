import { serve } from "@hono/node-server";
import {
  disconnectApplicationResources,
  initializeServerApplication,
} from "@/configuration/bootstrap/startup";
import { disconnectLogging, loggerFactory } from "@/configuration/logging";
import {
  disposeContainer,
  getContainer,
} from "@/configuration/bootstrap/container";
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

    // Disposed before the resources it depends on, and awaited, because this is
    // what closes upgraded WebSockets and gives back the presence counts they
    // hold. Skipping it made every rollout look to the other party like an
    // abrupt process death: sockets dropped without a close frame, and each
    // side left marked online until its lease expired. Redis has to still be
    // connected for those decrements to land, so this runs first.
    await Promise.allSettled([disposeContainer()]);

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
