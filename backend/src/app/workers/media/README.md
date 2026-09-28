# Media Workers

These workers use backend configuration and domain services. See [default.yml](../../../../config/default.yml), [backend configuration](../../../../../docs/backend-configuration.md), and the [worker index](../README.md) for startup and logging.

## Media Processing

[media-processing.worker.ts](./media-processing.worker.ts) runs as `media-processing-worker` and explicitly connects MySQL and RabbitMQ. It consumes `media.processing.main`, which `POST /media/{id}/complete` publishes to, and turns a quarantined upload into a displayable image through the [processing service](../../features/media/media-processing.service.ts). It needs configured blob storage. Without Azure, the development fallback keeps blobs on local disk, and Compose shares that disk with the API through the `backend_blob_storage` volume.

For each job the service:

1. Claims the media row. A row that is missing, still `pending_upload`, or already `ready` or `rejected` cannot be claimed, so duplicate and late jobs do nothing. A row left in `processing` by an interrupted run can be claimed again.
2. Reads the properties of `quarantine/images/<userId>/<mediaId>` before downloading it. A blob whose ETag differs from the one recorded at completion is rejected first, and then an empty blob or one over the size limit, all without being downloaded. Any write after completion changes the ETag, even a re-upload of identical bytes, so that is rejected too. Rows completed before the ETag was recorded skip the ETag comparison and keep the size checks.
3. Downloads the blob under `If-Match` on that ETag, asking for at most one byte past the size limit, and checks its real length, format, frame count, and dimensions with the image policy, against the type declared when the upload started and today's allow-list. A blob that changes or grows past the limit during the download is rejected.
4. Re-encodes an accepted image to WebP at `media/images/<userId>/<mediaId>.webp`. Re-encoding applies the EXIF orientation, then scales the upright image down so its longest edge is at most `imageUploads.maxProcessedEdge` (2560 by default, keeping the aspect ratio and never enlarging), converts the pixels to sRGB, and drops metadata such as EXIF, GPS, and ICC profiles. The width, height, and size recorded on the row describe this processed image. From the processed image it then writes a medium rendition, 800 px wide, at `<mediaId>.medium.webp` and a thumbnail, 300 px wide, at `<mediaId>.thumbnail.webp` beside it. Each is only written when the processed image is wider than it, since a copy of the same width would only duplicate it. They are sized by width so that a portrait is never picked too small. Making them from the processed image, not the upload, means the upload is decoded only once. All of them are uploaded before the row is marked `ready`, and the row's `variants` column records each smaller rendition's dimensions and size, or `null` for one that was not written. A failure part way through is retried, and the retry overwrites the same names. If the row was deleted or rejected while the job ran, all three are deleted instead. Decoding fails only on errors, not warnings, so a JPEG that libjpeg recovers from is accepted, and truncated data is still rejected. An APNG is read as a static PNG, because libvips does not report its frames, so it is published as its first frame. It then marks the row `ready` and deletes the quarantined upload.
5. Marks a row whose bytes fail the policy (413, 415, or 422, including an animated or multi-page image), whose upload is missing, or whose upload changed after completion `rejected` with the reason, and deletes the quarantined upload. These are final, and they are not retried. A failure to read the properties or the bytes, such as storage being unavailable, is retried.

`workers.mediaProcessing` defaults to prefetch 10 and maximum attempts 5. `MEDIA_PROCESSING_PREFETCH` and `MEDIA_PROCESSING_MAX_ATTEMPTS` override those values. Success and final rejection are acknowledged. Any other failure, such as storage being unavailable, increments the attempt count and republishes the job to a retry tier. The [queue service](../../features/media/media-processing.queue.service.ts) defines three delayed tiers of 5 s, 30 s, and 120 s. A job that exhausts its attempts goes to `media.processing.dead-letter`, and its row is marked `rejected` with "The image could not be processed." so the client polling `GET /media/{id}` stops waiting. Marking the row is best effort: if it fails too, for example because the database outage that exhausted the retries is still in progress, the failure is logged and the job is still acknowledged, so it is not redelivered. The [media cleanup worker](#media-cleanup) later rejects an item left unfinished. Only a failure to publish the job onward leaves it unacknowledged, and the consumer then requeues it.

To verify it, upload an image through `POST /media/uploads`, PUT the bytes, and complete it. `GET /media/{id}` should reach `ready` with a `url` under `media/images/` and, for an image wider than 800 px, `variants` giving the `.thumbnail.webp`, `.medium.webp`, and processed blobs with their widths, and the quarantine blob should be gone. Repeat with a non-image renamed to `.png`: the item should become `rejected` with a reason, and no `media/images/` blob should exist. On Azure, complete a valid image and then immediately PUT a different file to the same `upload.url`: the item should become `rejected` with "The upload changed after it was completed.", and no `media/images/` blob should exist.

## Media Cleanup

[media-cleanup.worker.ts](./media-cleanup.worker.ts) runs as `media-cleanup-worker` and explicitly connects MySQL and RabbitMQ. It finishes off media items that will not finish by themselves, through the [cleanup service](../../features/media/media-cleanup.service.ts). It works from the `media` table alone, with no listing of blob storage, so it cleans Azure and the local-disk fallback alike. Compose gives it the `backend_blob_storage` volume for that reason.

Each sweep runs three steps, each on at most `batchSize` items:

1. **Abandoned uploads.** An item still `pending_upload` more than `pendingUploadTtlMs` after it was created was never completed: the client closed the tab, or the PUT failed. Its quarantined upload is deleted first, then its row, but only if the row is still `pending_upload`. An upload completed while the sweep ran keeps its row, and processing rejects it because its bytes are gone. An item the client never confirmed is deleted, not processed.
2. **Stuck items.** An item in `uploaded` or `processing` whose `updated_at` has not moved for `stuckThresholdMs` has most likely lost its job. RabbitMQ redelivers a job whose worker died, but not one lost when it was published. The sweep claims the row by moving its `updated_at` to now, so only one sweep acts on it and the next one waits another threshold, then publishes a new job to `media.processing.main`. A job for an item another worker has since finished does nothing, because processing claims the row too. An item created more than `maxProcessingAgeMs` ago is rejected with "The image could not be processed." instead, and its quarantined upload is deleted, so an item that keeps failing is not retried forever and a polling client stops waiting.
3. **Old rejections.** An item `rejected` more than `rejectedRetentionMs` ago has any leftover quarantined upload deleted, then its row, if it is still `rejected`.

A `ready` item is never selected, and every change is conditional on the status the item was read in, so running several replicas is safe. A step that fails for one item, for example because storage or RabbitMQ is unavailable, logs a warning with the `mediaId`, moves on to the next item, and leaves the failed one for a later sweep. A sweep that handled anything is followed at once by the next, so a backlog drains at full speed. Otherwise the worker waits `pollIntervalMs`. It logs `Media cleanup sweep completed.` with the counts only when a sweep handled or failed on something.

`POST /media/{id}/complete` still re-queues an item left in `uploaded` for 60 s when the client repeats it. That is only a fast path; this worker is what guarantees an item finishes. The manual `blob-cleanup` command remains the backstop for blobs that no row accounts for.

`workers.mediaCleanup` defaults to a 5-minute poll interval, a batch of 100, a 24-hour pending-upload TTL, a 15-minute stuck threshold, a 24-hour maximum processing age, and a 24-hour rejected retention. Each has a `MEDIA_CLEANUP_*` override; see [backend configuration](../../../../../docs/backend-configuration.md#media-cleanup-worker).

To verify it, start an upload with `POST /media/uploads` and PUT its bytes without completing it, then backdate the row:

```sql
UPDATE media SET created_at = NOW() - INTERVAL 2 DAY WHERE id = '<mediaId>';
```

After the next sweep, the row and its `quarantine/images/<userId>/<mediaId>` blob are gone. To see a lost job recovered, complete an upload, then run `UPDATE media SET status = 'processing', updated_at = NOW() - INTERVAL 1 HOUR WHERE id = '<mediaId>'`. The item should reach `ready`. With `created_at` also set two days back, it should become `rejected`. Set `MEDIA_CLEANUP_POLL_INTERVAL_MS` in `.env` to shorten the wait while testing.

## Operations

```bash
docker compose logs --tail=100 media-processing-worker media-cleanup-worker log-consumer-worker
```

Check the ready, unacknowledged, retry, and dead-letter counts for the `media.processing.*` queues in RabbitMQ management, and the `status` and `rejection_reason` columns of `media` in MySQL. Use the [testing guide](../../../../../docs/testing-guide.md) for checks against real infrastructure.
