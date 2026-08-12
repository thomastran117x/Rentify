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

  const server = app.listen(port, "0.0.0.0", () => {
    serverLogger.info("Server listening.", {
      hostname: "0.0.0.0",
      port,
    });
  });

  // Attached to the Node server directly, which is what `app.listen` returns.
  // Express has no WebSocket story of its own, and routing an upgrade through
  // its middleware stack would mean faking a response object the stack could
  // write to — the upgrade is not a request/response exchange.
  getContainer()
    .resolve(containerTokens.bookingMessageSocketServer)
    .attach(server);

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

    // Sockets first, and awaited: this is what closes upgraded WebSockets with
    // a close frame and gives back the presence leases they hold. Redis has to
    // still be connected for those writes to land, so it runs ahead of the
    // disconnects below. Skipping it made every rollout look to the other party
    // like an abrupt process death.
    await Promise.allSettled([disposeContainer()]);

    // Express's close() waits for keep-alive sockets to go idle on their own,
    // which would hang shutdown in the container. Run after the disposal above,
    // so the WebSockets get their close frame rather than being cut off here.
    server.closeIdleConnections();

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
