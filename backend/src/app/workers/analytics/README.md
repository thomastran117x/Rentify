# Postings Analytics Worker

[postings-analytics.worker.ts](./postings-analytics.worker.ts) runs as `analytics-worker`. It polls and claims the MySQL postings analytics outbox, then updates aggregates for views, search impressions/clicks, booking lifecycle, payments, renting confirmations, and refunds.

## Processing and Configuration

The entrypoint explicitly connects MySQL. `workers.analytics` in [default.yml](../../../../config/default.yml) defaults to a 2,000 ms idle poll and batches of 50; use [backend configuration](../../../../../docs/backend-configuration.md) for overrides.

Successful jobs are marked processed. Per-job failures are logged with job/event identifiers and passed to `markOutboxRetry` with the next attempt and error text; retry scheduling lives in the [analytics implementation](../../features/postings/analytics). This is a database outbox, not a RabbitMQ consumer. Outer loop failures use the shared polling delay.

## Operations and Validation

Start the stack from the repository root, then inspect:

```bash
docker compose logs --tail=100 analytics-worker
docker compose logs --tail=100 log-consumer-worker
```

Exercise a posting view or booking event and confirm its outbox job is processed and the corresponding analytics aggregate changes. For a failure check, verify a failed job retains retry/error information rather than being marked processed. Follow the [testing guide](../../../../../docs/testing-guide.md) for automated persistence checks.
