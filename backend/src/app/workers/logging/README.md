# Application Log Consumer

[log-consumer.worker.ts](./log-consumer.worker.ts) runs as `log-consumer-worker`. It consumes `application-logs.main` from RabbitMQ and renders application log events as readable container output.

## Processing and Configuration

The entrypoint explicitly connects RabbitMQ and sets prefetch to the fixed value 100. General logging settings live under `logging` in [default.yml](../../../../config/default.yml); there is no `workers.logConsumer` setting. See [log-queue.service.ts](../../configuration/logging/log-queue.service.ts) for topology and publisher behavior.

Error/critical events go to stderr; other levels go to stdout. An event is acknowledged after the stream write completes. A write failure emits a direct `[LOG CONSUMER FAILURE]` line and negatively acknowledges the message with requeue enabled. Although the topology includes retry/dead-letter queues, this callback does not implement bounded retry routing; repeated write failures can keep requeueing.

## Operations and Validation

```bash
docker compose logs --tail=100 log-consumer-worker
docker compose logs --tail=100 backend
```

Generate a normal application event and verify it appears in consumer output. Check broker ready/unacknowledged counts if logs stop arriving. If the broker is unavailable, inspect producer output and fallback files on the shared log volume. When changing this worker, test stream-write failures and requeue behavior without publishing errors back into the same logging pipeline. See [backend configuration](../../../../../docs/backend-configuration.md) and the [testing guide](../../../../../docs/testing-guide.md).
