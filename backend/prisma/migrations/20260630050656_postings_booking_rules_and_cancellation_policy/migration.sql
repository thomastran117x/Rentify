-- AlterTable
ALTER TABLE `postings` ADD COLUMN `advance_notice_days` INTEGER NULL,
    ADD COLUMN `cancellation_policy` ENUM('flexible', 'moderate', 'strict') NULL,
    ADD COLUMN `cancellation_policy_notes` VARCHAR(500) NULL,
    ADD COLUMN `min_booking_duration_days` INTEGER NULL;
