# Shared Worker Runtime

This directory contains helpers, not an executable worker or Compose service. Read [worker-runtime.ts](./worker-runtime.ts) and [resources.ts](./resources.ts) alongside the entrypoint using them.

## Startup and Polling

`bootstrapWorker` loads backend configuration, connects declared resources sequentially, initializes the root container, logs startup, installs shutdown handlers, and invokes the worker-specific run callback. `startWorker` catches bootstrap failures, logs a critical error, attempts resource/logging cleanup, and exits with status 1.

`bootstrapPollingWorker` creates a service scope for each pass and disposes it in `finally`. It immediately starts another pass when the returned count is positive, sleeps for the configured interval when no work is reported, and logs/sleeps after a pass throws. Per-job retries and state transitions belong to domain services and repositories. Search maintainers implement their own independent scheduling loops.

Queue workers register stop-consumer and, where applicable, scope-disposal callbacks. Their acknowledgment and retry policies are defined in their entrypoints and queue/domain services.

## Resources and Shutdown

Resource adapters wrap database, Redis, Elasticsearch, and RabbitMQ connect/disconnect functions. `searchBrokerWorkerResources` contains database, Elasticsearch, and RabbitMQ adapters; it does not contain Redis.

On the first `SIGINT` or `SIGTERM`, `WorkerLifecycle` marks shutdown requested, logs the signal, attempts registered tasks, resource disconnections, and logging cleanup with `Promise.allSettled`, then exits with status 0. These operations run concurrently. The implementation does not await every in-flight polling pass or consumer callback before exiting, and cleanup failures do not prevent the exit. Do not describe this as guaranteed graceful draining.

## Configuration and Verification

Configuration loading is shared with the API; see [backend configuration](../../../../../docs/backend-configuration.md). Poll intervals, batch sizes, and broker prefetch are chosen by individual entrypoints. Resource connection details come from backend configuration and secrets.

Start through `docker compose up --build` and inspect `docker compose logs --tail=100 SERVICE` with a real service from the [worker index](../README.md). A normal startup should establish dependencies and begin polling/consumption. A startup failure should log a critical error and exit nonzero; a polling failure should log the failed loop and wait before retrying. For runtime changes, test startup, failure, scope disposal, and signal behavior using the [testing guide](../../../../../docs/testing-guide.md).
