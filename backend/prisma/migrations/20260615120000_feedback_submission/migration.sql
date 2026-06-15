CREATE TABLE `feedback` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NULL,
  `name` VARCHAR(160) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `category` ENUM('bug_report', 'feature_request', 'usability', 'praise', 'other') NOT NULL,
  `message` VARCHAR(2000) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  CONSTRAINT `feedback_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `feedback_user_id_created_at_idx`
  ON `feedback`(`user_id`, `created_at`);

CREATE INDEX `feedback_category_created_at_idx`
  ON `feedback`(`category`, `created_at`);
