-- Support the media cleanup worker.
--
-- `processing_requeues` counts the processing jobs the cleanup has queued for
-- an item whose job was lost. The cleanup rejects the item once the count
-- reaches its limit, so an item that never finishes is bounded by attempts
-- rather than by its age, and a processing outage cannot reject valid uploads.
--
-- The cleanup finds abandoned uploads by `status = 'pending_upload'` and
-- `created_at`, oldest first, which the new index serves directly.

-- AlterTable
ALTER TABLE `media` ADD COLUMN `processing_requeues` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `media_status_created_at_idx` ON `media`(`status`, `created_at`);
