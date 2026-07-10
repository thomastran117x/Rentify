-- AlterTable
ALTER TABLE `postings` ADD COLUMN `average_rating` DECIMAL(3, 2) NULL,
    ADD COLUMN `instant_booking` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `review_count` INTEGER NOT NULL DEFAULT 0;
