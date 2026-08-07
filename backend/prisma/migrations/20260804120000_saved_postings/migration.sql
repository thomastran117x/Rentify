-- CreateTable
CREATE TABLE `saved_postings` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `posting_id` VARCHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `saved_postings_user_id_posting_id_key`(`user_id`, `posting_id`),
  INDEX `saved_postings_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `saved_postings_posting_id_idx`(`posting_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `saved_postings`
  ADD CONSTRAINT `saved_postings_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `saved_postings_posting_id_fkey`
  FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
