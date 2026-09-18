# SMS Delivery Worker

[sms-delivery.worker.ts](./sms-delivery.worker.ts) runs as `sms-worker`. It consumes `sms.delivery.main` jobs and delivers through the configured SMS adapter. The local default is `noop`, which does not send a real SMS.

## Dependencies, Configuration, and Retries

The entrypoint explicitly connects RabbitMQ. Provider settings are under `sms`; `workers.sms` in [default.yml](../../../../config/default.yml) defaults to prefetch 10 and maximum attempts 8. Telnyx credentials come from environment secrets; see [backend configuration](../../../../../docs/backend-configuration.md).

Success is acknowledged. Failures are classified by the delivery service: retryable errors below the attempt limit are published to delayed retry queues; permanent errors and exhausted attempts go to `sms.delivery.dead-letter`. The original is acknowledged after publication. The [queue service](../../features/sms/sms.queue.service.ts) defines `sms.delivery.retry.1` through `.3` with 5 s, 30 s, and 120 s delays, using the final tier for later attempts. Logs include job, error classification, and attempt metadata.

## Operations and Validation

```bash
docker compose logs --tail=100 sms-worker
docker compose logs --tail=100 log-consumer-worker
```

Confirm the consumer receives a queued SMS and acknowledges the job with the configured adapter. Do not treat noop success as proof of phone delivery. Test retryable and permanent errors and inspect retry/dead-letter queues. Follow the [testing guide](../../../../../docs/testing-guide.md).
