# Posting Workers

These workers use backend configuration and domain services. See [default.yml](../../../../config/default.yml), [backend configuration](../../../../../docs/backend-configuration.md), and the [worker index](../README.md) for startup and logging.

## Posting Expiry

[posting-expiry.worker.ts](./posting-expiry.worker.ts) runs as `posting-expiry-worker` and explicitly connects MySQL, Redis, and RabbitMQ. It first pauses due postings, then enqueues reminders for the upcoming expiry window. Redis supports the booking-window lock and public cache invalidation; RabbitMQ carries reminder emails.

`workers.postingExpiry` defaults to a 60,000 ms idle poll, batches of 50, and a 3-day reminder lead. The [expiry service](../../features/postings/posting-expiry.service.ts) owns transitions and reminder state. The shared runtime logs/delays thrown passes and drains positive counts immediately; this entrypoint does not implement broker retry routing. Actual reminder delivery is handled by the email worker.

Verify a due posting becomes paused and an upcoming posting receives the single intended reminder. Verify already handled or ineligible postings do not get repeated transitions/reminders.

## Posting Thumbnails

[posting-thumbnail.worker.ts](./posting-thumbnail.worker.ts) runs as `posting-thumbnail-worker` and explicitly connects MySQL and RabbitMQ. It consumes `postings.thumbnail.main`, calls thumbnail generation for the posting, and needs configured blob storage for image access/output.

The 640x480 crop is cut from the primary photo's medium rendition (`<mediaId>.medium.webp`, 800 px) when it has one that covers the crop without enlarging, which decodes far less than the full processed image. A photo with no renditions, one not yet backfilled, or one whose shape leaves the medium rendition too small, such as a panorama, is cropped from the full photo instead.

`workers.postingsThumbnail` defaults to prefetch 10 and maximum attempts 5. Success is acknowledged. Failed jobs increment attempts and are republished to a retry tier or `postings.thumbnail.dead-letter`, then the original is acknowledged. The [queue service](../../features/postings/thumbnail/thumbnail.queue.service.ts) defines three delayed tiers of 5 s, 30 s, and 120 s.

Verify a photo update results in expected thumbnail references/output. Exercise missing/unusable image or provider failures and confirm retry/dead-letter behavior. Do not assume seeded image URLs validate Azure access.

## Saved Search Alerts

[saved-search-alert.worker.ts](./saved-search-alert.worker.ts) runs as `saved-search-alert-worker` and explicitly connects MySQL, Redis, Elasticsearch, and RabbitMQ. It claims due saved searches, replays the same public search path as browsing, and enqueues emails for unseen matches.

`workers.savedSearchAlert` defaults to a 300,000 ms poll, batches of 25, and a 24-hour daily interval. Instant checks use the polling interval. Invalid filters are marked invalidated. Per-search errors are logged; claimed searches have their next check advanced and retry on a later turn. Email enqueue precedes seen-match recording, so a crash between them can cause a duplicate alert rather than silently losing it. The [alert service](../../features/postings/saved-searches/saved-search-alert.service.ts) owns this policy; email delivery has its own retry pipeline.

Verify a new matching posting produces an alert/seen record and an already seen posting does not trigger another. Exercise invalid saved filters and an empty result. Seeded `rentify.local` emails are suppressed outside production.

## Operations

```bash
docker compose logs --tail=100 posting-expiry-worker posting-thumbnail-worker saved-search-alert-worker
docker compose logs --tail=100 email-worker log-consumer-worker
```

Check database transitions for pollers and consumer/retry/dead-letter counts for thumbnail and email jobs. Use the [testing guide](../../../../../docs/testing-guide.md) for checks against real infrastructure.
