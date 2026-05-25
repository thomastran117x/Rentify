import {
  initializeContainer,
  type RootServiceContainer,
  type ServiceContainer,
} from "@/configuration/bootstrap/container";
import { loadEnvironment } from "@/configuration/environment/index";
import { disconnectLogging, loggerFactory } from "@/configuration/logging";

export interface WorkerResource {
  connect: () => Promise<unknown>;
  disconnect: () => Promise<unknown>;
}

export interface WorkerContext {
  container: RootServiceContainer;
}

export interface ScopedWorkerContext {
  rootContainer: RootServiceContainer;
  scope: ServiceContainer;
}

export async function bootstrapWorker(input: {
  name: string;
  resources: WorkerResource[];
  run: (context: WorkerContext, lifecycle: WorkerLifecycle) => Promise<void>;
}): Promise<void> {
  loadEnvironment();

  for (const resource of input.resources) {
    await resource.connect();
  }

  const lifecycle = new WorkerLifecycle(input.name, input.resources);
  const container = initializeContainer();
  const workerLogger = loggerFactory
    .forComponent("worker-runtime", "worker")
    .child({
      workerName: input.name,
    });

  workerLogger.info("Worker started.");
  lifecycle.registerShutdownHandlers();

  await input.run(
    {
      container,
    },
    lifecycle,
  );
}

export async function bootstrapPollingWorker(input: {
  name: string;
  resources: WorkerResource[];
  getPollIntervalMs: () => number;
  runOnce: (context: ScopedWorkerContext) => Promise<number | void>;
}): Promise<void> {
  await bootstrapWorker({
    name: input.name,
    resources: input.resources,
    run: async ({ container }, lifecycle) => {
      const workerLogger = loggerFactory
        .forComponent("worker-runtime", "worker")
        .child({
          workerName: input.name,
        });
      while (!lifecycle.isShuttingDown()) {
        const scope = container.createScope();

        try {
          const processedCount = await input.runOnce({
            rootContainer: container,
            scope,
          });

          if ((processedCount ?? 0) === 0) {
            await sleep(input.getPollIntervalMs());
          }
        } catch (error) {
          workerLogger.error("Worker loop failed.", undefined, error);
          await sleep(input.getPollIntervalMs());
        } finally {
          await scope.dispose();
        }
      }
    },
  });
}

export function startWorker(input: {
  name: string;
  bootstrap: () => Promise<void>;
  cleanup: () => Promise<unknown>;
}): void {
  void input.bootstrap().catch(async (error: unknown) => {
    loggerFactory
      .forComponent("worker-runtime", "worker")
      .child({
        workerName: input.name,
      })
      .critical("Failed to start worker.", undefined, error);
    await Promise.allSettled([input.cleanup(), disconnectLogging()]);
    process.exit(1);
  });
}

export function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export class WorkerLifecycle {
  private shuttingDown = false;
  private readonly shutdownTasks: Array<() => Promise<unknown>> = [];

  constructor(
    private readonly name: string,
    private readonly resources: WorkerResource[],
  ) {}

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  addShutdownTask(task: () => Promise<unknown>): void {
    this.shutdownTasks.push(task);
  }

  registerShutdownHandlers(): void {
    process.once("SIGINT", () => {
      void this.shutdown("SIGINT");
    });

    process.once("SIGTERM", () => {
      void this.shutdown("SIGTERM");
    });
  }

  async shutdown(signal: NodeJS.Signals): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    loggerFactory
      .forComponent("worker-runtime", "worker")
      .child({
        workerName: this.name,
      })
      .info("Worker shutdown requested.", {
        signal,
      });
    await Promise.allSettled([
      ...this.shutdownTasks.map((task) => task()),
      ...this.resources.map((resource) => resource.disconnect()),
      disconnectLogging(),
    ]);
    process.exit(0);
  }
}
