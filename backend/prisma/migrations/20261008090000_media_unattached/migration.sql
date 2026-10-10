-- Mark a ready image the media cleanup deleted because nothing attached it.
--
-- `unattached` is recorded when a processed image stayed unreferenced for
-- `workers.mediaCleanup.unattachedReadyTtlMs`: its renditions are deleted, and
-- the row is kept as a tombstone for the rejected retention, so a late save
-- that sends its media id is told why rather than that it does not exist.

-- AlterTable
ALTER TABLE `media` MODIFY `rejection_code` ENUM('empty', 'too_large', 'unsupported_type', 'type_mismatch', 'dimensions', 'corrupt', 'animated', 'upload_changed', 'missing_upload', 'processing_failed', 'abandoned', 'malware', 'moderation', 'unscreenable', 'unattached') NULL;
