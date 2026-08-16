-- AlterTable
ALTER TABLE `organization_blog_posts`
  ADD COLUMN `comments_enabled` BOOLEAN NOT NULL DEFAULT true AFTER `status`;

-- AlterEnum
-- MySQL rewrites the whole ENUM definition in place. The new value is appended
-- rather than inserted so every existing row's ordinal is unchanged.
ALTER TABLE `content_reports`
  MODIFY `subject_type` ENUM('posting', 'posting_review', 'user', 'organization_blog_comment') NOT NULL;

-- CreateTable
CREATE TABLE `organization_blog_comments` (
  `id` VARCHAR(36) NOT NULL,
  `blog_post_id` VARCHAR(36) NOT NULL,
  `organization_id` VARCHAR(36) NOT NULL,
  `author_user_id` VARCHAR(36) NOT NULL,
  `body` VARCHAR(2000) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `edited_at` DATETIME(6) NULL,
  `deleted_at` DATETIME(6) NULL,
  `deleted_by_user_id` VARCHAR(36) NULL,

  PRIMARY KEY (`id`),
  INDEX `organization_blog_comments_blog_post_id_created_at_idx`(`blog_post_id`, `created_at`),
  INDEX `organization_blog_comments_author_user_id_created_at_idx`(`author_user_id`, `created_at`),
  INDEX `organization_blog_comments_organization_id_created_at_idx`(`organization_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `organization_blog_comments`
  ADD CONSTRAINT `organization_blog_comments_blog_post_id_fkey`
    FOREIGN KEY (`blog_post_id`) REFERENCES `organization_blog_posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_blog_comments`
  ADD CONSTRAINT `organization_blog_comments_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_blog_comments`
  ADD CONSTRAINT `organization_blog_comments_author_user_id_fkey`
    FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_blog_comments`
  ADD CONSTRAINT `organization_blog_comments_deleted_by_user_id_fkey`
    FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
