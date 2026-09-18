# Email Delivery Worker

[email-delivery.worker.ts](./email-delivery.worker.ts) runs as `email-worker`. It consumes `email.delivery.main` jobs and calls the delivery service. Some message composers hydrate records at send time; saved-search messages also query current search results.

## Dependencies, Configuration, and Retries

The entrypoint explicitly connects MySQL, Redis, Elasticsearch, and RabbitMQ. External delivery uses configured email credentials. `workers.email` in [default.yml](../../../../config/default.yml) defaults to prefetch 10 and maximum attempts 8; provider configuration is under `email` with secrets supplied through the environment.

Successful delivery is acknowledged. A failure increments the payload attempt, publishes to a retry queue or `email.delivery.dead-letter` at the attempt limit, then acknowledges the original message. The [queue service](../../features/email/email.queue.service.ts) defines `email.delivery.retry.1` through `.3` with 5 s, 30 s, and 120 s delays; later retry attempts use the final delay tier. Do not assume exactly-once delivery.

Recipients under `rentify.local` are suppressed outside production by [email-suppression.ts](../../features/email/email-suppression.ts). A seeded message can complete without sending real mail.

## Operations and Validation

```bash
docker compose logs --tail=100 email-worker
docker compose logs --tail=100 log-consumer-worker
```

Inspect consumer counts, ready/unacknowledged jobs, retries, and dead letters in RabbitMQ management. Validate a real message flow and the expected UI/API state; use a controlled recipient/provider when actual delivery is required. Verify provider failure produces retry/dead-letter behavior, not success feedback based solely on queue acceptance. See [backend configuration](../../../../../docs/backend-configuration.md) and the [testing guide](../../../../../docs/testing-guide.md).
