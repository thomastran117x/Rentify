-- AlterTable
ALTER TABLE `booking_messages`
  ADD COLUMN `delivered_at` DATETIME(6) NULL AFTER `read_at`;
