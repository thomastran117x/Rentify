# Recommendation Workers

Recommendation activity collection and snapshot precomputation are separate flows. Successful activity ingestion alone does not prove that recommendation snapshots were rebuilt.

## Activity Consumer

[recommendation-activity.worker.ts](./recommendation-activity.worker.ts) runs as `recommendation-activity-worker`. It explicitly connects MySQL and RabbitMQ, consumes `recommendation-activity.main`, validates event payloads, and applies them through the activity processor.

Prefetch 20 and the retry threshold 4 are constants in the entrypoint, not YAML worker settings. Invalid payloads are immediately dead-lettered. Processing failures increment `x-retry-attempt`, publish a retry or dead-letter payload, then acknowledge the original. The [queue service](../../features/recommendations/recommendation-activity.queue.service.ts) owns retry delays and `recommendation-activity.dead-letter`.

Verify an event updates activity persistence and the relevant refresh work. Test malformed payloads and a processor failure, then inspect retries/dead letters.

## Precompute Poller

[recommendation-precompute.worker.ts](./recommendation-precompute.worker.ts) explicitly connects MySQL and processes claimed recommendation refresh jobs. It also enqueues missing/stale popular jobs. The [precompute service](../../features/recommendations/recommendation-precompute.service.ts) rebuilds user/popular artifacts, marks successful jobs processed, and records per-job retry state and errors.

`workers.recommendationsPrecompute` in [default.yml](../../../../config/default.yml) defaults to a 5,000 ms idle poll and batches of 25. Ranking and freshness rules are in domain constants, not these worker cadence settings.

There is no precompute service in [docker-compose.yml](../../../../../docker-compose.yml). The build includes its compiled entrypoint, and a direct watch script exists, but `docker compose up --build` does not start it. To exercise it using Compose-provided infrastructure, start the full stack and deliberately run the compiled process as a separate one-off container:

```bash
docker compose run --rm --no-deps backend node dist/workers/recommendations/recommendation-precompute.worker.js
```

Keep that process running while validating. This uses the backend service environment/pool settings and does not create a permanent worker service. Verify refresh jobs complete and snapshot timestamps/content change. Check an invalid job retains retry/error state.

## Operations and Configuration

```bash
docker compose logs --tail=100 recommendation-activity-worker
docker compose logs --tail=100 log-consumer-worker
```

Inspect precompute output in its one-off terminal; `docker compose logs recommendation-precompute-worker` is invalid because that service does not exist. See [backend configuration](../../../../../docs/backend-configuration.md) and the [testing guide](../../../../../docs/testing-guide.md).
