# Identity Bloom Worker

[identity-bloom.worker.ts](./identity-bloom.worker.ts) runs as `identity-bloom-worker`. It rebuilds username and email availability Bloom filters from MySQL into Redis so API instances can use current identity hints.

## Processing and Configuration

Both MySQL and Redis are explicitly connected. Configuration is `identityBloom.username` and `identityBloom.email` in [default.yml](../../../../config/default.yml): enabled flags, capacity, false-positive rate, rebuild interval, batch size, and lock TTL. Each subject has independent Redis locks and freshness records. Disabled subjects are skipped.

The polling cadence is the shorter rebuild interval divided by six, with a 60,000 ms minimum. Each subject decides whether rebuilding is due; every pass returns zero so it sleeps. A filter is not rebuilt on every poll. The [rebuild implementation](../../features/auth/identity-bloom/identity-bloom-rebuild.ts) handles generation publication and locking; the shared polling loop logs and delays failures.

## Operations and Validation

```bash
docker compose logs --tail=100 identity-bloom-worker
docker compose logs --tail=100 log-consumer-worker
```

Confirm a due rebuild publishes a generation and that username/email availability checks remain correct. A second worker or a fresh generation should result in a skipped rebuild; test a failed rebuild's lock/publication behavior when changing this flow. Bloom results are hints, so database uniqueness rules remain essential. See [backend configuration](../../../../../docs/backend-configuration.md) and the [testing guide](../../../../../docs/testing-guide.md).
