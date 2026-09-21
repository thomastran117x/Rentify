# Background Workers

Worker entrypoints live here and are built into `backend/dist/workers`. They use the backend image, configuration loader, domain services, and shared runtime. Start the application and its configured workers from the repository root:

```bash
docker compose up --build
```

## Worker Directory

| Directory                                      | Entrypoint                                      | Compose service                              | Trigger                                      |
| ---------------------------------------------- | ----------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| [analytics](./analytics/README.md)             | `postings-analytics.worker.ts`                  | `analytics-worker`                           | MySQL analytics outbox                       |
| [auth](./auth/README.md)                       | `identity-bloom.worker.ts`                      | `identity-bloom-worker`                      | Scheduled username/email filter rebuilds     |
| [bookings](./bookings/README.md)               | `booking-expiry.worker.ts`                      | `booking-expiry-worker`                      | Expired booking candidates                   |
| [email](./email/README.md)                     | `email-delivery.worker.ts`                      | `email-worker`                               | RabbitMQ email jobs                          |
| [logging](./logging/README.md)                 | `log-consumer.worker.ts`                        | `log-consumer-worker`                        | RabbitMQ application logs                    |
| [media](./media/README.md)                     | `media-processing.worker.ts`                    | `media-processing-worker`                    | RabbitMQ media processing jobs               |
| [organizations](./organizations/README.md)     | `organization-search-maintainer.worker.ts`      | `organization-search-maintainer-worker`      | Organization outbox, reindex, reconciliation |
| [organizations](./organizations/README.md)     | `organization-search-indexer.worker.ts`         | `organization-search-indexer-worker`         | RabbitMQ organization index jobs             |
| [organizations](./organizations/README.md)     | `organization-blog-search-maintainer.worker.ts` | `organization-blog-search-maintainer-worker` | Blog outbox, reindex, reconciliation         |
| [organizations](./organizations/README.md)     | `organization-blog-search-indexer.worker.ts`    | `organization-blog-search-indexer-worker`    | RabbitMQ blog index jobs                     |
| [payments](./payments/README.md)               | `payment-retry.worker.ts`                       | `payment-retry-worker`                       | Retryable payment attempts                   |
| [payments](./payments/README.md)               | `payment-repair.worker.ts`                      | `payment-repair-worker`                      | Payments requiring reconciliation            |
| [payments](./payments/README.md)               | `payout-release.worker.ts`                      | `payout-release-worker`                      | Due payout records                           |
| [postings](./postings/README.md)               | `posting-expiry.worker.ts`                      | `posting-expiry-worker`                      | Expiry dates and reminder windows            |
| [postings](./postings/README.md)               | `posting-thumbnail.worker.ts`                   | `posting-thumbnail-worker`                   | RabbitMQ thumbnail jobs                      |
| [postings](./postings/README.md)               | `saved-search-alert.worker.ts`                  | `saved-search-alert-worker`                  | Due saved searches                           |
| [recommendations](./recommendations/README.md) | `recommendation-activity.worker.ts`             | `recommendation-activity-worker`             | RabbitMQ activity events                     |
| [recommendations](./recommendations/README.md) | `recommendation-precompute.worker.ts`           | None                                         | MySQL recommendation refresh jobs            |
| [reports](./reports/README.md)                 | `report-search-indexer.worker.ts`               | `report-search-indexer-worker`               | MySQL report search outbox                   |
| [search](./search/README.md)                   | `search-maintainer.worker.ts`                   | `search-maintainer-worker`                   | Posting outbox, reindex, reconciliation      |
| [search](./search/README.md)                   | `search-indexer.worker.ts`                      | `search-indexer-worker`                      | RabbitMQ posting index jobs                  |
| [sms](./sms/README.md)                         | `sms-delivery.worker.ts`                        | `sms-worker`                                 | RabbitMQ SMS jobs                            |
| [shared](./shared/README.md)                   | No executable worker                            | None                                         | Runtime and resource helpers                 |

Recommendation precompute is included in source, watch scripts, and the backend build, but has no service in [docker-compose.yml](../../../../docker-compose.yml). The default stack does not run it. Its directory README shows how to run the compiled entrypoint with Compose-provided infrastructure.

## Configuration and Operations

Read [backend configuration](../../../../docs/backend-configuration.md) for YAML profiles, secret injection, and overrides. Worker defaults live under `workers` in [default.yml](../../../config/default.yml), except identity filters under `identityBloom` and constants identified in individual guides. Do not put secrets into committed YAML.

Compose workers inherit the backend environment and use database pool limits of 5 connections and 1 minimum idle per database-connected process. Some services declare more startup dependencies than their entrypoints explicitly connect; see the service definition and domain service calls before changing dependencies.

After startup, inspect service state and the selected worker's logs. Substitute a service from the table:

```bash
docker compose ps -a
docker compose logs --tail=100 email-worker
docker compose logs --tail=100 log-consumer-worker
```

Logging is centralized through RabbitMQ with fallback files under the shared `backend_logs` volume. Inspect both the worker and log-consumer output. A running container or the generic "Worker started." line alone does not prove that work is progressing: the runtime logs startup before the worker-specific run callback finishes.

For consumers, check ready/unacknowledged counts, consumers, retries, and dead-letter queues in RabbitMQ management at `http://localhost:15673` by default. For pollers, inspect due candidates/outbox status and the expected domain result. Pollers do not all use RabbitMQ retries. Neither this runtime nor these guides promise exactly-once processing or a graceful drain of all in-flight work.

Use the [testing guide](../../../../docs/testing-guide.md) for automated checks and validation against real infrastructure. Individual READMEs identify a visible success result and a useful failure check. Direct watch scripts are an explicitly selected non-Docker development alternative, not the default validation runtime.
