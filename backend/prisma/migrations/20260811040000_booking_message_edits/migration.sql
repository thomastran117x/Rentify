-- AlterTable
ALTER TABLE `booking_messages`
  ADD COLUMN `edited_at` DATETIME(6) NULL AFTER `read_at`,
  ADD COLUMN `deleted_at` DATETIME(6) NULL AFTER `edited_at`;
