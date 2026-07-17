CREATE TABLE `organization_blog_posts` (
  `id` VARCHAR(36) NOT NULL,
  `organization_id` VARCHAR(36) NOT NULL,
  `author_user_id` VARCHAR(36) NULL,
  `title` VARCHAR(200) NOT NULL,
  `slug` VARCHAR(220) NOT NULL,
  `excerpt` VARCHAR(300) NULL,
  `body` TEXT NOT NULL,
  `cover_image_url` VARCHAR(1024) NULL,
  `cover_image_blob_name` VARCHAR(1024) NULL,
  `tags` JSON NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `published_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `organization_blog_posts_organization_id_slug_key`(`organization_id`, `slug`),
  INDEX `organization_blog_posts_organization_id_status_published_at_idx`(`organization_id`, `status`, `published_at`),
  INDEX `organization_blog_posts_author_user_id_created_at_idx`(`author_user_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `organization_blog_posts`
  ADD CONSTRAINT `organization_blog_posts_organization_id_fkey`
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `organization_blog_posts_author_user_id_fkey`
  FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
