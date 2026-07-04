-- CreateTable
CREATE TABLE `saved_searches` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `search_params` JSON NOT NULL,
    `alert_enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_alert_sent_at` DATETIME(6) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL,

    INDEX `saved_searches_user_id_idx`(`user_id`),
    INDEX `saved_searches_alert_enabled_last_alert_sent_at_idx`(`alert_enabled`, `last_alert_sent_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `saved_searches` ADD CONSTRAINT `saved_searches_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
