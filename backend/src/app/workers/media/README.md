# Media Workers

These workers use backend configuration and domain services. See [default.yml](../../../../config/default.yml), [backend configuration](../../../../../docs/backend-configuration.md), and the [worker index](../README.md) for startup and logging.

## Media Processing

[media-processing.worker.ts](./media-processing.worker.ts) runs as `media-processing-worker` and explicitly connects MySQL and RabbitMQ. It consumes `media.processing.main`, which `POST /media/{id}/complete` publishes to, and turns a quarantined upload into a displayable image through the [processing service](../../features/media/media-processing.service.ts). It needs configured blob storage. Without Azure, the development fallback keeps blobs on local disk, and Compose shares that disk with the API through the `backend_blob_storage` volume.

For each job the service:

1. Claims the media row. A row that is missing, still `pending_upload`, or already `ready` or `rejected` cannot be claimed, so duplicate and late jobs do nothing. A row left in `processing` by an interrupted run can be claimed again. Each claim increments `processing_attempts`, sets `processing_started_at`, and clears the previous attempt's malware scan in the same guarded update. `processing_completed_at` is set when the row becomes `ready` or `rejected`.
2. Reads the properties of `quarantine/images/<userId>/<mediaId>` before downloading it. A blob whose ETag differs from the one recorded at completion is rejected first, and then an empty blob or one over the size limit, all without being downloaded. Any write after completion changes the ETag, even a re-upload of identical bytes, so that is rejected too. Rows completed before the ETag was recorded skip the ETag comparison and keep the size checks.
3. Downloads the blob under `If-Match` on that ETag, asking for at most one byte past the size limit. Before anything decodes the bytes, it scans them with the configured [malware scanner](../../features/media/scanning/malware-scanner.ts) and records the verdict in `scan_status` (`clean`, `infected`, or `skipped` when `MEDIA_SCANNER` is `none`), `scan_engine`, and `scanned_at`. It then checks the bytes' real length, format, frame count, and dimensions with the image policy, against the type declared when the upload started and today's allow-list. A blob that changes or grows past the limit during the download is rejected.
4. Re-encodes an accepted image to WebP at `media/images/<userId>/<mediaId>.webp`. Re-encoding applies the EXIF orientation, then scales the upright image down so its longest edge is at most `imageUploads.maxProcessedEdge` (2560 by default, keeping the aspect ratio and never enlarging), converts the pixels to sRGB, and drops metadata such as EXIF, GPS, and ICC profiles. The width, height, and size recorded on the row describe this processed image. From the processed image it then writes a medium rendition, 800 px wide, at `<mediaId>.medium.webp` and a thumbnail, 300 px wide, at `<mediaId>.thumbnail.webp` beside it. Each is only written when the processed image is wider than it, since a copy of the same width would only duplicate it. They are sized by width so that a portrait is never picked too small. Making them from the processed image, not the upload, means the upload is decoded only once. All of them are uploaded before the row is marked `ready`, and the row's `variants` column records each smaller rendition's dimensions and size, or `null` for one that was not written. A failure part way through is retried, and the retry overwrites the same names. If the row was deleted or rejected while the job ran, all three are deleted instead. Decoding fails only on errors, not warnings, so a JPEG that libjpeg recovers from is accepted, and truncated data is still rejected. An APNG is read as a static PNG, because libvips does not report its frames, so it is published as its first frame. It then marks the row `ready` and deletes the quarantined upload.
5. Marks a row whose bytes fail the policy (413, 415, or 422, including an animated or multi-page image), whose upload is missing, or whose upload changed after completion `rejected` with the reason and a `rejection_code`, and deletes the quarantined upload. The policy's refusals carry their code in `details.rejectionCode`: `empty`, `too_large`, `unsupported_type`, `type_mismatch`, `dimensions`, `corrupt`, or `animated`. A missing upload is `missing_upload`, and one changed after completion is `upload_changed`. An upload the scanner finds infected is `malware`, with the reason "This file can't be used."; the signature it matched goes only to the row's `threat_name` and a warning log with the media and user ids, never to the reason or a response. These are final, and they are not retried. A failure to read the properties or the bytes, such as storage being unavailable, is retried, and so is a scanner that cannot give a verdict: clamd unreachable, timing out, or answering with an error. The row can only become `ready` from `scan_status` `clean` or `skipped`, a condition the repository's guarded update enforces, so a job that never got a verdict is retried, then dead-lettered, and is never published unscanned.

`workers.mediaProcessing` defaults to prefetch 10 and maximum attempts 5. `MEDIA_PROCESSING_PREFETCH` and `MEDIA_PROCESSING_MAX_ATTEMPTS` override those values. Success and final rejection are acknowledged. Any other failure, such as storage or the malware scanner being unavailable, is first recorded in the row's `processing_error` column as the error's class and message, cut to 1,000 characters, and then increments the attempt count and republishes the job to a retry tier. Recording the failure is best effort: if it fails too, that is logged and the job is still handed on. `processing_error` is for operators; no API response carries it. The [queue service](../../features/media/media-processing.queue.service.ts) defines three delayed tiers of 5 s, 30 s, and 120 s. The job payload's `attempt` counts the retry tiers one job has been through; the row's `processing_attempts` counts every claim, including a redelivery after a worker died and a job the media cleanup queued again, so the two can differ. A job that exhausts its attempts goes to `media.processing.dead-letter`, and its row is marked `rejected` with "The image could not be processed." and the code `processing_failed`, so the client polling `GET /media/{id}` stops waiting. Unlike every other rejection, this one keeps the quarantined upload: the image was never found at fault, so once the cause is fixed the job can be replayed with the [dead-letter runbook](#dead-letter-runbook). The [media cleanup worker](#media-cleanup) deletes the upload with the row once the rejected retention has passed. Marking the row is best effort: if it fails too, for example because the database outage that exhausted the retries is still in progress, the failure is logged and the job is still acknowledged, so it is not redelivered. The [media cleanup worker](#media-cleanup) later rejects an item left unfinished. Only a failure to publish the job onward leaves it unacknowledged, and the consumer then requeues it.

To verify it, upload an image through `POST /media/uploads`, PUT the bytes, and complete it. `GET /media/{id}` should reach `ready` with a `url` under `media/images/` and, for an image wider than 800 px, `variants` giving the `.thumbnail.webp`, `.medium.webp`, and processed blobs with their widths, and the quarantine blob should be gone. Repeat with a non-image renamed to `.png`: the item should become `rejected` with a reason, and no `media/images/` blob should exist. On Azure, complete a valid image and then immediately PUT a different file to the same `upload.url`: the item should become `rejected` with "The upload changed after it was completed.", and no `media/images/` blob should exist.

## Media Cleanup

[media-cleanup.worker.ts](./media-cleanup.worker.ts) runs as `media-cleanup-worker` and explicitly connects MySQL and RabbitMQ. It finishes off media items that will not finish by themselves, through the [cleanup service](../../features/media/media-cleanup.service.ts). It works from the `media` table alone, with no listing of blob storage, so it cleans Azure and the local-disk fallback alike. Compose gives it the `backend_blob_storage` volume for that reason.

Each sweep runs three steps, each on at most `batchSize` items:

1. **Abandoned uploads.** An item still `pending_upload` more than `pendingUploadTtlMs` after it was created was never completed: the client closed the tab, or the PUT failed. The sweep first claims the row by marking it `rejected`, with the code `abandoned`, but only while it is still `pending_upload`, then deletes its quarantined upload, then the row. A completion racing the sweep either lands before the claim, and the upload is left alone, or finds the item rejected; it can never move the row on after its bytes are gone. If deleting the upload fails, the rejected row stays and step 3 tries again. An item the client never confirmed is deleted, not processed.
2. **Stuck items.** An item in `uploaded` or `processing` whose `updated_at` has not moved for `stuckThresholdMs` may have lost its job. RabbitMQ redelivers a job whose worker died, but not one lost when it was published. An unmoved item only means a lost job when nothing else explains it, so the step first reads the processing queues. While jobs wait in `media.processing.main` or a retry tier, or no worker consumes the main queue, the item's job may just be delayed by a backlog or an outage, and the step leaves every stuck item alone and counts it as `deferred`. A job being processed does not look unmoved either: the processing service moves `updated_at` after the download, after the malware scan, and after rendering. When the queues are idle, the sweep claims the row by moving its `updated_at` to now and counting the re-queue in `processing_requeues`, so only one sweep acts on it and the next one waits another threshold. It then publishes a new job to `media.processing.main`. A job for an item another worker has since finished does nothing, because processing claims the row too. An item already queued again `maxRequeues` times is rejected with "The image could not be processed." and `processing_failed` instead, keeping its quarantined upload as the dead-letter path does, so an item that keeps failing is bounded by attempts rather than by how long it waited, and a polling client stops waiting. The rejection, like the claim, applies only while `updated_at` is still unmoved, so an item a job picked up in the meantime is left to finish.
3. **Old rejections.** An item `rejected` more than `rejectedRetentionMs` ago has any leftover quarantined upload deleted, including one a `processing_failed` rejection kept for a replay, then its row, if it is still `rejected`. An item whose upload cannot be deleted has its `updated_at` moved to now, so it goes to the back of the purge order instead of holding up newer rejections, and is tried again after another retention period.

A `ready` item is never selected, and every change is conditional on the item still being in the state it was selected in, so running several replicas is safe as long as their clocks agree to well within the stuck threshold. A step that fails for one item, for example because storage or RabbitMQ is unavailable, logs a warning with the `mediaId`, moves on to the next item, and leaves the failed one for a later sweep. A sweep that handled anything is followed at once by the next, so a backlog drains at full speed. Otherwise the worker waits `pollIntervalMs`. It logs `Media cleanup sweep completed.` with the counts only when a sweep handled, deferred, or failed on something. Deferred and failed items do not count as work, so the worker waits out the poll interval before trying them again.

`POST /media/{id}/complete` still re-queues an item left in `uploaded` for 60 s when the client repeats it. That is only a fast path; this worker is what guarantees an item finishes. The manual `blob-cleanup` command remains the backstop for blobs that no row accounts for.

`workers.mediaCleanup` defaults to a 5-minute poll interval, a batch of 100, a 24-hour pending-upload TTL, a 15-minute stuck threshold, at most 3 re-queues, and a 24-hour rejected retention. Each has a `MEDIA_CLEANUP_*` override; see [backend configuration](../../../../../docs/backend-configuration.md#media-cleanup-worker).

To verify it, start an upload with `POST /media/uploads` and PUT its bytes without completing it, then backdate the row:

```sql
UPDATE media SET created_at = NOW() - INTERVAL 2 DAY WHERE id = '<mediaId>';
```

After the next sweep, the row and its `quarantine/images/<userId>/<mediaId>` blob are gone. To see a lost job recovered, complete an upload, then run `UPDATE media SET status = 'processing', updated_at = NOW() - INTERVAL 1 HOUR WHERE id = '<mediaId>'`. With the processing worker running and its queues empty, the item should reach `ready`. With `processing_requeues` also set to 3, it should become `rejected`. With the processing worker stopped, the sweep should log it as `deferred` and leave it unchanged. Set `MEDIA_CLEANUP_POLL_INTERVAL_MS` in `.env` to shorten the wait while testing.

## Operations

```bash
docker compose logs --tail=100 media-processing-worker media-cleanup-worker log-consumer-worker
```

Check the ready, unacknowledged, retry, and dead-letter counts for the `media.processing.*` queues in RabbitMQ management, and the `status`, `rejection_reason`, `rejection_code`, `processing_attempts`, `processing_started_at`, `processing_completed_at`, `processing_error`, `scan_status`, `scan_engine`, `scanned_at`, and `threat_name` columns of `media` in MySQL. Use the [testing guide](../../../../../docs/testing-guide.md) for checks against real infrastructure.

### Metrics and alerts

The pipeline records the metrics below through the `MediaMetrics` port in [media-metrics.ts](../../features/media/media-metrics.ts). Today each one is a structured `media.metric` log event, `{ metric, value, tags }`, emitted at `info` by the service that records it: `backend` for uploads and completion rejections, `media-processing-worker` for processing and dead letters, and `media-cleanup-worker` for cleanup rejections. Outside production the logger writes to each service's own output; in production it publishes to the application log queue, and the events come out of `log-consumer-worker`. Follow them with:

```bash
docker compose logs -f backend media-processing-worker media-cleanup-worker log-consumer-worker | grep media.metric
```

Each is recorded exactly once per occurrence. A counter's value is 1. A metric that fails to record is dropped, and never fails the request or job. Tags never carry a user id, media id, or filename; those stay in the log context. Each tag is typed as a closed set of values, and a row's `scope` that is not a known scope is recorded as `unknown`. See [Image Upload Validation](../../../../../docs/architecture-overview.md#image-upload-validation) for the port and the planned OpenTelemetry backend.

The events obey the log level, because they are logs. With `LOG_LEVEL` above `info` (or `logging.level` in YAML) every `media.metric` event is dropped, and so is everything the alerts below are built on. Each service that records metrics logs `Media metrics are disabled` at startup when that happens. Keep the level at `info` or lower wherever these alerts are used, until the OpenTelemetry adapter, which does not go through the logger, replaces this one.

| Metric                      | Kind             | Recorded                                                                                                               | Tags                                                |
| --------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `media.upload.created`      | counter          | `POST /media/uploads` recorded the item.                                                                               | `scope`, `declaredType`                             |
| `media.upload.completed`    | counter          | `POST /media/{id}/complete` moved the item to `uploaded`. A repeated or re-queuing completion is not counted again.    | `scope`                                             |
| `media.bytes.original`      | observation (B)  | With `media.upload.completed`: the upload's stored length.                                                             | `scope`                                             |
| `media.processing.duration` | observation (ms) | Every claimed processing attempt, from the claim to its end.                                                           | `scope`, `outcome`                                  |
| `media.processing.success`  | counter          | The attempt that marked the item `ready`. A duplicate job that finds it already ready is not counted.                  | `scope`                                             |
| `media.bytes.processed`     | observation (B)  | With `media.processing.success`: the processed image's size, as recorded in `size_bytes`.                              | `scope`                                             |
| `media.processing.failure`  | counter          | A processing attempt threw, counted once its job has been handed on to a retry tier or the dead-letter queue.          | `attempt`, `retrying` (`false` on the last attempt) |
| `media.dlq.published`       | counter          | A job was published to `media.processing.dead-letter`.                                                                 | none                                                |
| `media.rejected`            | counter          | The item was marked `rejected` by this actor; a racing rejection, or a repeat of one already recorded, is not counted. | `code` (the `rejection_code`), `stage`              |

`stage` is `completion` (the size check in `POST /media/{id}/complete`), `processing` (the worker's malware, policy, missing-upload, and changed-upload rejections), `dead_letter` (a job that exhausted its attempts), or `cleanup` (the media cleanup rejecting an item still stuck after its last re-queue). One `media.rejected{code}` metric replaces separate metrics per reason, so a new rejection code needs no new metric. An abandoned upload is not counted: it was never completed, and counting it would skew the rejection rate below. A `processing_failed` item that is [replayed](#dead-letter-runbook) and fails again is a new rejection, with no new completion, so replaying many items while an outage is still partly in effect raises the rejection rate; those rejections are `processing_failed` under `dead_letter` or `cleanup`.

A failed publish leaves the job unacknowledged and the consumer requeues it with the same attempt, so `media.processing.failure` is counted only after the hand-off succeeds; the redelivery counts it otherwise. The counters `media.upload.completed`, `media.processing.success`, and `media.dlq.published` repeat what `media.bytes.original`, `media.bytes.processed`, and `media.processing.failure{retrying=false}` already imply. They are kept, as #348 specified, so that each dashboard and alert reads one metric by name, at the cost of a few extra log events per upload.

`outcome` is `ready` or `rejected` when this attempt finished the item, `discarded` when something else did first (the item was deleted, or a duplicate job made it ready or rejected it while the attempt ran), or `failed` for an attempt that threw and is retried or dead-lettered. An item deleted between its claim and being read back is recorded under the `scope` `unknown`, since its row is gone.

Alert on:

- **Dead letters:** `media.processing.dead-letter` depth above 0. Follow the [dead-letter runbook](#dead-letter-runbook).
- **Rejection rate:** `media.rejected` above 20 % of `media.upload.completed + media.rejected{stage="completion"}` over 15 minutes. A completion-stage rejection, an empty or oversized upload refused by `POST /media/{id}/complete`, never reaches `uploaded`, so it is added to the denominator as well; otherwise a burst of oversized uploads could push the ratio past 100 % while processing is healthy. Group by `code` to see why, and by `stage` to see where.
- **Slow processing:** p95 of `media.processing.duration` above 10 s. Image processing is the backend's most CPU-intensive job, so a rising p95 is an early capacity signal.
- **Stuck items:** any row still `uploaded` or `processing` 15 minutes after it last moved, the same statuses the media cleanup treats as stuck. A job lost when it was published leaves its row in `uploaded`. The cleanup takes such an item for one whose job was lost after `stuckThresholdMs` (15 minutes by default) and moves it on, so a count that stays above 0 means the cleanup is deferring it or failing. `updated_at` is stored in UTC, so compare it with `UTC_TIMESTAMP()` rather than `NOW()`, which follows the session time zone:

  ```sql
  SELECT COUNT(*) FROM media
  WHERE status IN ('uploaded', 'processing')
    AND updated_at < UTC_TIMESTAMP() - INTERVAL 15 MINUTE;
  ```

### Dead-letter runbook

A job lands in `media.processing.dead-letter` after `MEDIA_PROCESSING_MAX_ATTEMPTS` failed attempts, usually because storage, the database, the broker, or clamd was unavailable for longer than the retry tiers (5 s, 30 s, and 120 s) cover. Its item is then either `rejected` with `processing_failed` and its upload kept, or, when the outage also stopped the rejection from being recorded, still `uploaded` or `processing`. Either way the image was not found at fault, and it can be replayed once the cause is fixed. A final rejection (any other code) cannot be replayed; the user has to upload again.

1. Check the dead-letter count for `media.processing.dead-letter` in RabbitMQ management, and read the failures that put jobs there:

   ```sql
   SELECT id, status, rejection_code, processing_attempts, processing_started_at, processing_error
   FROM media
   WHERE rejection_code = 'processing_failed' OR status IN ('uploaded', 'processing')
   ORDER BY updated_at DESC;
   ```

   `processing_error` holds the class and message of the last failure, which is enough to tell an outage from a bug. `processing_attempts` counts every claim, including redeliveries and jobs the media cleanup queued again, so it can exceed the `attempt` a job payload carries, which counts only the retry tiers one job went through.

2. Fix the cause, then preview the replay. A dry run makes no changes and leaves every message in the queue:

   ```bash
   docker compose run --rm --build media-dead-letter-replay --dry-run
   ```

3. Run it:

   ```bash
   docker compose run --rm --build media-dead-letter-replay
   ```

4. Replay what the queue does not hold. An item the media cleanup rejected after its jobs were lost was never dead-lettered, and a message can be lost too. `--from-database` replays every item rejected as `processing_failed` within the rejected retention whose upload is still kept, with or without a message. It takes `--dry-run` as well:

   ```bash
   docker compose run --rm --build media-dead-letter-replay --from-database --dry-run
   docker compose run --rm --build media-dead-letter-replay --from-database
   ```

   Messages for items it replays stay in the queue; a later queue replay reports them as `skipped`.

The command takes up to `--limit` messages or items (1,000 by default). From the queue it takes only the messages ready when it starts, so a replayed job that fails again during the run is left for the next run. It prints a JSON summary with one entry per message or item, and an `error` when the run had to stop early, such as when the broker closed its channel; the entries before it were still settled, and the command exits 1:

| Outcome          | Meaning                                                                                                                                                                                                              | Message           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `replayed`       | Rejected with `processing_failed` within the rejected retention and its upload still kept: moved back to `uploaded`, with a fresh `processing_requeues` budget, and queued again.                                    | Removed           |
| `requeued`       | Still `uploaded` or `processing`, because rejecting it failed too, and unmoved since its job was dead-lettered: claimed and queued again.                                                                            | Removed           |
| `skipped`        | Nothing to do: the item is `missing`, already `ready`, already being handled (`in_flight`: moved since its job was dead-lettered, by a replay, a cleanup re-queue, or a worker), or `changed` while the command ran. | Removed           |
| `not_replayable` | A `final_rejection`, an upload already deleted (`upload_deleted`), an upload never completed (`not_uploaded`), or a rejection past its retention that the media cleanup is purging (`expired`).                      | Removed           |
| `invalid`        | The message is not a processing job.                                                                                                                                                                                 | Removed           |
| `duplicate`      | An earlier message in the same run handled the same item.                                                                                                                                                            | Removed           |
| `failed`         | Handling it failed; the entry carries the error. The command exits 1.                                                                                                                                                | Left in the queue |

Every replayed job starts again at `attempt` 0, so an item that fails again goes through all the retry tiers before it is dead-lettered once more. Each change is guarded on the row's status: a user deleting the item, the media cleanup purging it, or a second replay running at the same time leaves it `skipped` rather than undone. An unfinished item is claimed before it is queued again, by moving its `updated_at`, and only while it has not moved since its job was dead-lettered, so duplicate messages for one item queue a single job even when they fall in separate or concurrent runs. A `processing_failed` upload is only kept until the rejected retention passes (`MEDIA_CLEANUP_REJECTED_RETENTION_MS`, 24 hours by default). An item past it is reported `not_replayable` (`expired`) and never reopened, so a replay cannot race the purge; once purged, its message reports `skipped` (`missing`). The manual `blob-cleanup` command never deletes a kept upload, but an Azure lifecycle rule on `quarantine/` shorter than the time to rejection plus that retention does; the item then reports `not_replayable` (`upload_deleted`). See the [lifecycle backstop](../../../../../docs/architecture-overview.md).
