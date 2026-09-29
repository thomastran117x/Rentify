-- Record how processing went for each media item.
--
-- `processing_attempts` counts claims by a processing job, redeliveries
-- included, so it can exceed the retry tier a job's payload carries.
-- `processing_started_at` is set on each claim and `processing_completed_at`
-- when the item becomes ready or rejected. `processing_error` keeps the last
-- internal failure for operators; no API response carries it.

-- AlterTable
ALTER TABLE `media` ADD COLUMN `processing_attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `processing_started_at` DATETIME(6) NULL,
    ADD COLUMN `processing_completed_at` DATETIME(6) NULL,
    ADD COLUMN `processing_error` VARCHAR(1000) NULL;
