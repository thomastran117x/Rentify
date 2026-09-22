-- Pin the uploaded bytes at completion.
--
-- The upload credential stays valid after `POST /media/{id}/complete`, so a
-- client could complete with a small blob and then overwrite it with a much
-- larger one before the media processing worker ran. The size recorded at
-- completion would no longer describe the bytes being processed, and the
-- worker would buffer the replacement whole before rejecting it.
--
-- `original_etag` records the blob's ETag when the upload is completed. The
-- worker refuses an original whose ETag has changed, and downloads it only
-- under `If-Match` on that ETag. Rows completed before this column existed
-- keep it NULL and skip the comparison; their size is still checked.

-- AlterTable
ALTER TABLE `media` ADD COLUMN `original_etag` VARCHAR(100) NULL;
