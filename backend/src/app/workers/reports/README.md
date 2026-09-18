# Report Search Indexer

[report-search-indexer.worker.ts](./report-search-indexer.worker.ts) runs as `report-search-indexer-worker`. It explicitly connects MySQL and Elasticsearch, polls the report search outbox, and delegates to [ReportsService](../../features/reports/reports.service.ts).

## Processing and Configuration

The poll interval is a fixed 2,000 ms and batch size is a fixed 25 in the entrypoint. They are not taken from `workers.search`. Elasticsearch enablement, connection, and report index settings follow [backend configuration](../../../../../docs/backend-configuration.md).

The service upserts current report documents or deletes documents for delete operations/missing reports. Successful outbox entries are marked processed; per-entry failures retry in the database and become dead-lettered after 5 attempts, as defined by `MAX_SEARCH_OUTBOX_ATTEMPTS` in the service.

Although Compose currently uses the search dependency group, which includes RabbitMQ, this entrypoint does not consume a broker queue or use broker dead letters.

## Operations and Validation

```bash
docker compose logs --tail=100 report-search-indexer-worker
docker compose logs --tail=100 log-consumer-worker
```

Create/update a report and verify its searchable document and processed outbox status. Verify a delete removes the document; test indexing failures for retry and database dead-letter state. Use the [testing guide](../../../../../docs/testing-guide.md) for real-infrastructure validation.
