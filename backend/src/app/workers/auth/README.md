# Auth Workers

This directory holds the identity Bloom filter worker and the auth audit prune worker.

## Identity Bloom Worker

[identity-bloom.worker.ts](./identity-bloom.worker.ts) runs as `identity-bloom-worker`. It rebuilds username and email availability Bloom filters from MySQL into Redis so API instances can use current identity hints.

### Processing and Configuration

Both MySQL and Redis are explicitly connected. Configuration is `identityBloom.username` and `identityBloom.email` in [default.yml](../../../../config/default.yml): enabled flags, capacity, false-positive rate, rebuild interval, batch size, and lock TTL. Each subject has independent Redis locks and freshness records. Disabled subjects are skipped.

The polling cadence is the shorter rebuild interval divided by six, with a 60,000 ms minimum. Each subject decides whether rebuilding is due; every pass returns zero so it sleeps. A filter is not rebuilt on every poll. The [rebuild implementation](../../features/auth/identity-bloom/identity-bloom-rebuild.ts) handles generation publication and locking; the shared polling loop logs and delays failures.

### Operations and Validation

```bash
docker compose logs --tail=100 identity-bloom-worker
docker compose logs --tail=100 log-consumer-worker
```

Confirm a due rebuild publishes a generation and that username/email availability checks remain correct. A second worker or a fresh generation should result in a skipped rebuild; test a failed rebuild's lock/publication behavior when changing this flow. Bloom results are hints, so database uniqueness rules remain essential. See [backend configuration](../../../../../docs/backend-configuration.md) and the [testing guide](../../../../../docs/testing-guide.md).

## Auth Audit Prune Worker

[auth-audit-prune.worker.ts](./auth-audit-prune.worker.ts) runs as `auth-audit-prune-worker`. It deletes `auth_audit_events` rows older than the retention period. They carry IP addresses and user agents; see [Retention](../../../../../docs/auth-security.md#retention) for the policy.

### Processing and Configuration

Only MySQL is connected. Configuration is `authAudit` in [default.yml](../../../../config/default.yml): `retentionDays` (180), `pruneBatchSize` (1000) and `pruneIntervalMinutes` (60). See [backend configuration](../../../../../docs/backend-configuration.md#auth-audit-retention).

The worker runs once at startup and then once per `pruneIntervalMinutes`. Each run, done by [AuthAuditRetentionService](../../features/auth/audit/auth-audit-retention.service.ts), computes the cutoff as now minus `retentionDays`. It then lists the oldest `pruneBatchSize` ids created before the cutoff through the `(created_at)` index and deletes them by id, repeating until a batch comes back short. Every run logs `Auth audit prune completed.` with `deleted`, `batches`, `cutoff` and `retentionDays`.

Running several replicas is safe. They only race to delete the same ids, and the loser deletes nothing. A database error ends the run, and the shared polling loop logs `Worker loop failed.` and waits one interval. Rows already deleted stay deleted, and the next run continues from the oldest remaining row.

### Operations and Validation

```bash
docker compose logs --tail=100 auth-audit-prune-worker
```

To see a deletion, set `AUTH_AUDIT_RETENTION_DAYS=1` in `.env` and start the stack. Then insert a row older than that and restart the worker so its startup run picks the row up:

```bash
docker compose exec mysql mysql -urent -prent rent -e "
  INSERT INTO auth_audit_events (id, event_type, outcome, created_at)
  VALUES (UUID(), 'login.succeeded', 'success', NOW(6) - INTERVAL 3 DAY);"
docker compose restart auth-audit-prune-worker
docker compose logs --tail=20 auth-audit-prune-worker
```

The log should show `deleted: 1`, the old row should be gone, and rows from recent sign-ins should remain. For a failure check, stop `mysql`. The next run logs `Worker loop failed.` while the container keeps running, and a run after `mysql` is back succeeds. A shorter `AUTH_AUDIT_PRUNE_INTERVAL_MINUTES` makes this quicker to watch. `AUTH_AUDIT_RETENTION_DAYS=0` stops the worker at startup with a validation error.
