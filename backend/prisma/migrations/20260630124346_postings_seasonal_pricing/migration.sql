-- CreateTable
CREATE TABLE `posting_seasonal_pricing` (
    `id` VARCHAR(36) NOT NULL,
    `posting_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `daily_amount` DECIMAL(10, 2) NOT NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL,

    INDEX `posting_seasonal_pricing_posting_id_idx`(`posting_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `posting_seasonal_pricing` ADD CONSTRAINT `posting_seasonal_pricing_posting_id_fkey` FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
