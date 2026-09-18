# Payment Workers

All three entrypoints use the shared polling runtime, explicitly connect MySQL, and delegate to [PaymentsService](../../features/payments/payments.service.ts). Provider-dependent flows also need configured PayPal connectivity and credentials. Configuration and secrets follow [backend configuration](../../../../../docs/backend-configuration.md).

## Payment Retry

[payment-retry.worker.ts](./payment-retry.worker.ts) runs as `payment-retry-worker`. It selects eligible retry attempts, marks an attempt ready, and creates a provider payment session using its existing idempotency key. Successful sessions are attached to persisted payments; provider failures are classified and recorded with analytics/search side effects.

`workers.paymentsRetry` in [default.yml](../../../../config/default.yml) defaults to a 5,000 ms idle poll and batches of 25. Retry eligibility and scheduling are persisted by the payment repository, not broker retry queues.

## Payment Repair

[payment-repair.worker.ts](./payment-repair.worker.ts) runs as `payment-repair-worker`. It selects payments requiring reconciliation and calls `repairPayment` to apply the provider's current status, including capture/finalization where required.

`workers.paymentsRepair` defaults to a 10,000 ms idle poll and batches of 25. A thrown repair error reaches the shared loop, which logs and delays the next pass; candidate selection remains governed by persisted payment state. This is not a blanket retry of all failed payments.

## Payout Release

[payout-release.worker.ts](./payout-release.worker.ts) runs as `payout-release-worker`. It selects due payout records and marks them released; a per-record error is recorded as a failed payout.

`workers.payoutRelease` defaults to a 15,000 ms idle poll and batches of 50. The current `processDuePayouts` implementation updates local payout records; it does not initiate a PayPal payout transfer. Do not equate a released record with a verified external funds transfer.

## Operations and Validation

```bash
docker compose logs --tail=100 payment-retry-worker payment-repair-worker payout-release-worker
docker compose logs --tail=100 log-consumer-worker
```

Verify an eligible retry attaches a provider session, repair converges a payment to provider state, and due payout records change as expected. Check an ineligible attempt/payout stays unchanged and provider failures retain useful state. Automated integration checks use provider stubs with real persistence; external PayPal validation requires intentionally configured sandbox credentials. Follow the [testing guide](../../../../../docs/testing-guide.md).
