# Media Variants Backfill

The media processing worker writes up to three renditions of every accepted
image: the processed image itself (`large`), a `medium` (800 px wide), and a
`thumbnail` (300 px wide), skipping a smaller one the image is no wider than.
See "Renditions" in the
[architecture overview](./architecture-overview.md#image-upload-validation).

Images processed before renditions existed only have the large one, and their
`media.variants` is `NULL`. The API offers only recorded renditions, so until
they are backfilled their variants fields are `null` and every surface
downloads the full image. Nothing breaks, but run the backfill **immediately
after deploying** the release that adds renditions.

## What it does

[`backfill-media-variants.ts`](../backend/src/app/scripts/backfill-media-variants.ts)
selects `ready` media rows whose `variants` column is `NULL`, in batches ordered
by id. For each one it downloads the processed image, writes the medium and
thumbnail beside it when the image is wider than them, and records them in
`media.variants`, as `null` for one it did not write. Responses offer the
renditions from then on; no cache needs clearing, because they are looked up
as each response is written.

- **Re-runnable.** A converted row no longer matches the selection, so a second
  run reports `scanned: 0`. A run interrupted part way through simply converts
  the rest; a rendition it had already written is overwritten.
- **Safe beside live traffic.** The row is only updated while it is still
  `ready` with the same processed image. If it was deleted mid-run, the
  renditions just written are deleted again; if a concurrent run recorded them
  first, they are kept. Either way the item counts as `skipped`.
- **Continues past failures.** A missing processed image, one that cannot be
  decoded, or one larger than the size its media row records is reported in
  `failures` and the run moves on. The exit code is 1 when anything failed.
- **Any processed size.** The download is bounded by the processed image's
  recorded size, not the upload limit. Images processed before the edge cap
  were re-encoded at full resolution and can be larger than any upload.

## Running it

The Compose service is in the `maintenance` profile and shares the backend's
environment and local blob volume:

```bash
# See what would be converted. Nothing is written.
docker compose run --rm --build media-variants-backfill --dry-run

# Convert them.
docker compose run --rm --build media-variants-backfill

# Optional: rows read per query (default 50, at most 500).
docker compose run --rm --build media-variants-backfill --batch-size 200
```

Note the flags are the reverse of `blob-cleanup`: that command only previews
unless given `--delete`, while this one writes unless given `--dry-run`. The
backfill only ever adds blobs next to live ones, so acting by default is the
safer choice here.

Each run prints a JSON summary:

```json
{
  "mode": "backfill",
  "scanned": 42,
  "converted": 41,
  "skipped": 0,
  "failed": 1,
  "failures": [
    {
      "mediaId": "8b0f3c1e-6a4d-4c8e-9f21-5d7b2a9e4c10",
      "processedBlobName": "media/images/<userId>/<mediaId>.webp",
      "message": "The processed image could not be found."
    }
  ],
  "pending": []
}
```

With `--dry-run`, `mode` is `dry-run` and `pending` lists every item a real run
would convert.

## After it runs

1. Run it again and confirm `scanned` is `0`, apart from items listed in
   `failures`.
2. Investigate each failure. A missing processed image usually means the blob
   was deleted outside the application; that image is already broken on every
   surface, and the backfill cannot repair it.
3. Preview the orphaned-blob cleanup and confirm it lists no `.medium.webp` or
   `.thumbnail.webp` blob of an image that is still in use:

   ```bash
   docker compose run --rm --build blob-cleanup
   ```

Storage grows by about 1.3x per image.

## Search index

The same release raises the postings index mapping version to add the primary
photo's renditions to the search document. The search maintainer reindexes by
itself once it runs the new version; see the
[search worker guide](../backend/src/app/workers/search/README.md#search-maintainer).
Search results are loaded from the database, not from the document, so they
show renditions immediately, before that reindex finishes. The document
records the renditions known when it was written, so one indexed before the
backfill reached its photo keeps `null` until the posting is next indexed or
the index is rebuilt with `POST /admin/search/reindex`.
