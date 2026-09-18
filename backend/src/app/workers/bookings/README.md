# Booking Expiry Worker

[booking-expiry.worker.ts](./booking-expiry.worker.ts) runs as `booking-expiry-worker`. It polls expired booking-request candidates and expires eligible holds. A successful transition enqueues an analytics event, invalidates the public posting projection, and enqueues posting search synchronization.

## Dependencies and Failure Behavior

The entrypoint explicitly connects MySQL. Cache invalidation also reaches the [public cache service](../../features/postings/postings.public-cache.service.ts), which can use Redis. Compose currently declares the database/migration dependency group for this service, rather than a Redis health dependency; do not infer all domain dependencies from that group.

`workers.bookingExpiry` in [default.yml](../../../../config/default.yml) defaults to a 5,000 ms idle poll and batches of 50. Each candidate failure is logged and processing continues. There is no per-candidate RabbitMQ retry/dead-letter policy here; subsequent eligibility and side effects depend on persisted state. A candidate already transitioned may no longer be selected even if a later side effect failed. Outer failures are logged and delayed by the shared polling runtime.

## Operations and Validation

```bash
docker compose logs --tail=100 booking-expiry-worker
docker compose logs --tail=100 log-consumer-worker
```

Create or use a due booking hold and verify its status, released availability, analytics outbox, and search synchronization. Verify a non-expired or ineligible request is unchanged. When modifying the flow, cover failures after the transition as well as expiration itself. See [backend configuration](../../../../../docs/backend-configuration.md) and the [testing guide](../../../../../docs/testing-guide.md).
