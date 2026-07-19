-- AlterTable
ALTER TABLE `organizations`
  ADD COLUMN `average_rating` DECIMAL(3, 2) NULL,
  ADD COLUMN `review_count` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `organization_reviews` (
  `id` VARCHAR(36) NOT NULL,
  `organization_id` VARCHAR(36) NOT NULL,
  `reviewer_id` VARCHAR(36) NOT NULL,
  `rating` INTEGER NOT NULL,
  `title` VARCHAR(120) NULL,
  `comment` TEXT NULL,
  `response` TEXT NULL,
  `response_author_id` VARCHAR(36) NULL,
  `responded_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `organization_reviews_organization_id_reviewer_id_key`(`organization_id`, `reviewer_id`),
  INDEX `organization_reviews_organization_id_created_at_idx`(`organization_id`, `created_at`),
  INDEX `organization_reviews_reviewer_id_idx`(`reviewer_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `organization_reviews`
  ADD CONSTRAINT `organization_reviews_organization_id_fkey`
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `organization_reviews_reviewer_id_fkey`
  FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `organization_reviews_response_author_id_fkey`
  FOREIGN KEY (`response_author_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
