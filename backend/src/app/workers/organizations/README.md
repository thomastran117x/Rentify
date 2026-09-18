# Organization and Blog Search Workers

Four workers maintain organization and organization-blog search projections. All explicitly connect MySQL, Elasticsearch, and RabbitMQ. They share the posting search cadence/batching settings but resolve separate domain services and queues.

## Entrypoints and Services

| Entrypoint                                                                                       | Compose service                              | Responsibility                                          |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------- |
| [organization-search-maintainer.worker.ts](./organization-search-maintainer.worker.ts)           | `organization-search-maintainer-worker`      | Organization outbox relay, reindex runs, reconciliation |
| [organization-search-indexer.worker.ts](./organization-search-indexer.worker.ts)                 | `organization-search-indexer-worker`         | Batched organization index jobs                         |
| [organization-blog-search-maintainer.worker.ts](./organization-blog-search-maintainer.worker.ts) | `organization-blog-search-maintainer-worker` | Blog outbox relay, reindex runs, reconciliation         |
| [organization-blog-search-indexer.worker.ts](./organization-blog-search-indexer.worker.ts)       | `organization-blog-search-indexer-worker`    | Batched blog index jobs                                 |

## Processing, Configuration, and Failures

Maintainers independently schedule relay, reindex, and reconciliation, with a separate scope per task and a 100 ms minimum idle sleep. Failed tasks are logged and retried on their next schedule. Defaults in [default.yml](../../../../config/default.yml) are `workers.searchRelay` (2,000 ms, batch 25, maximum attempts 8), `workers.searchReindex` (5,000 ms, batch 250), and `workers.searchReconcile` (60,000 ms, batch 50).

Indexers use `workers.searchIndexer`: prefetch 25, batch 25, flush interval 250 ms, concurrency 2, and maximum attempts 8. Effective prefetch is at least batch size times concurrency. Each resolves its own search service and queue service. Domain processing owns per-job retry/dead-letter state; successful batches are acknowledged. Unexpected batch exceptions are logged and all entries are negatively acknowledged with requeue enabled.

The configured organization/blog index names determine separate broker queue prefixes through their search queue services. Do not assume these consumers share the posting queue. Read [organization search](../../features/organizations/search) and [blog search](../../features/organizations/blog/search) alongside the entrypoints for projection and eligibility rules.

## Operations and Validation

```bash
docker compose logs --tail=100 organization-search-maintainer-worker organization-search-indexer-worker
docker compose logs --tail=100 organization-blog-search-maintainer-worker organization-blog-search-indexer-worker
docker compose logs --tail=100 log-consumer-worker
```

Verify an eligible organization update changes its search projection and a published blog change updates blog search. Check unpublished/removed content, queue isolation, and indexing failure handling for each pipeline. Inspect database outboxes, broker consumer/backlog state, and Elasticsearch projections together. See [backend configuration](../../../../../docs/backend-configuration.md) and the [testing guide](../../../../../docs/testing-guide.md).
