# Media Workers

These workers use backend configuration and domain services. See [default.yml](../../../../config/default.yml), [backend configuration](../../../../../docs/backend-configuration.md), and the [worker index](../README.md) for startup and logging.

## Media Processing

[media-processing.worker.ts](./media-processing.worker.ts) runs as `media-processing-worker` and explicitly connects MySQL and RabbitMQ. It consumes `media.processing.main`, which `POST /media/{id}/complete` publishes to, and turns a quarantined upload into a displayable image through the [processing service](../../features/media/media-processing.service.ts). It needs configured blob storage. Without Azure, the development fallback keeps blobs on local disk, and Compose shares that disk with the API through the `backend_blob_storage` volume.

For each job the service:

1. Claims the media row. A row that is missing, still `pending_upload`, or already `ready` or `rejected` cannot be claimed, so duplicate and late jobs do nothing. A row left in `processing` by an interrupted run can be claimed again.
2. Downloads `quarantine/images/<userId>/<mediaId>` and checks its real length, format, and dimensions with the image policy, against the type declared when the upload started and today's allow-list.
3. Re-encodes an accepted image to WebP at `media/images/<userId>/<mediaId>.webp`. Re-encoding applies the EXIF orientation and drops metadata such as EXIF and GPS. It then marks the row `ready` and deletes the quarantined upload.
4. Marks a row whose bytes fail the policy (413, 415, or 422) `rejected` with the reason and deletes the quarantined upload. These are final, and they are not retried.

`workers.mediaProcessing` defaults to prefetch 10 and maximum attempts 5. `MEDIA_PROCESSING_PREFETCH` and `MEDIA_PROCESSING_MAX_ATTEMPTS` override those values. Success and final rejection are acknowledged. Any other failure, such as storage being unavailable, increments the attempt count and republishes the job to a retry tier. The [queue service](../../features/media/media-processing.queue.service.ts) defines three delayed tiers of 5 s, 30 s, and 120 s. A job that exhausts its attempts goes to `media.processing.dead-letter`, and its row is marked `rejected` with "The image could not be processed." so the client polling `GET /media/{id}` stops waiting.

To verify it, upload an image through `POST /media/uploads`, PUT the bytes, and complete it. `GET /media/{id}` should reach `ready` with a `url` under `media/images/`, and the quarantine blob should be gone. Repeat with a non-image renamed to `.png`: the item should become `rejected` with a reason, and no `media/images/` blob should exist.

## Operations

```bash
docker compose logs --tail=100 media-processing-worker log-consumer-worker
```

Check the ready, unacknowledged, retry, and dead-letter counts for the `media.processing.*` queues in RabbitMQ management, and the `status` and `rejection_reason` columns of `media` in MySQL. Use the [testing guide](../../../../../docs/testing-guide.md) for checks against real infrastructure.
