# Posting Search Workers

The posting search pipeline uses a MySQL outbox, a RabbitMQ relay/consumer pair, and Elasticsearch documents. Both entrypoints explicitly connect MySQL, Elasticsearch, and RabbitMQ through the shared search resource group.

## Search Maintainer

[search-maintainer.worker.ts](./search-maintainer.worker.ts) runs as `search-maintainer-worker`. It schedules outbox relay, reindex runs, and reconciliation independently. Each task creates/disposes a scope, logs its failures, and is scheduled again according to its own cadence.

Defaults in [default.yml](../../../../config/default.yml):

| Configuration             | Idle/scheduled interval | Batch | Other                     |
| ------------------------- | ----------------------- | ----- | ------------------------- |
| `workers.searchRelay`     | 2,000 ms                | 25    | Maximum attempts 8        |
| `workers.searchReindex`   | 5,000 ms                | 250   | Reindex run processing    |
| `workers.searchReconcile` | 60,000 ms               | 50    | Reconciliation processing |

The maintainer has a 100 ms minimum idle sleep. Domain [SearchService](../../features/search/search.service.ts) owns relay state, retries, reindex runs, and reconciliation. These tasks are not one generic `workers.search` poll.

Postings mappings are `dynamic: false`, and each index records `POSTINGS_INDEX_MAPPING_VERSION` (in the [index service](../../features/postings/search/index.service.ts)) in its `_meta`. When a deploy raises that version, the reindex task finds the live index stale and starts a reindex run into a new index by itself, switching the alias once the run has caught up; nothing needs to be run by hand. To trigger one anyway, or to follow its progress, an admin can call `POST /admin/search/reindex` and `GET /admin/search/reindex-runs/{id}`. Version 4 added `primaryPhotoVariants`, the primary photo's rendition URLs, stored but not indexed.

## Search Indexer

[search-indexer.worker.ts](./search-indexer.worker.ts) runs as `search-indexer-worker`. It consumes index-job batches and passes them to the search service. `workers.searchIndexer` defaults to prefetch 25, batch 25, flush interval 250 ms, concurrency 2, and maximum attempts 8. Effective prefetch is the greater of configured prefetch and batch size times concurrency.

The [queue service](../../features/search/search.queue.service.ts) derives its prefix from the configured postings index: `<indexBaseName>.search-index`, with main, retry, and dead-letter queues. Service-level processing owns per-job retry/dead-letter decisions. The worker acknowledges entries after service processing succeeds; an unexpected batch exception logs identifiers and negatively acknowledges every entry with requeue enabled.

## Operations and Validation

```bash
docker compose logs --tail=100 search-maintainer-worker search-indexer-worker
docker compose logs --tail=100 log-consumer-worker
```

Change a posting, confirm relay/consumer progress and the public search result, then verify a removal/ineligible posting is handled correctly. Inspect broker backlog/dead letters and database outbox state when results lag. Test an indexing failure and a requested reindex/reconciliation path when changing this pipeline. See [backend configuration](../../../../../docs/backend-configuration.md) and the [testing guide](../../../../../docs/testing-guide.md).
