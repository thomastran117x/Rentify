ALTER TABLE `users`
  ADD COLUMN `preferred_organization_id` VARCHAR(36) NULL;

CREATE TABLE `organizations` (
  `id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `organization_memberships` (
  `id` VARCHAR(36) NOT NULL,
  `organization_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `role` ENUM('primary_manager', 'manager', 'operator') NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `organization_memberships_organization_id_user_id_key`(`organization_id`, `user_id`),
  INDEX `organization_memberships_user_id_role_idx`(`user_id`, `role`),
  INDEX `organization_memberships_organization_id_role_idx`(`organization_id`, `role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `organization_invitations` (
  `id` VARCHAR(36) NOT NULL,
  `organization_id` VARCHAR(36) NOT NULL,
  `invited_by_user_id` VARCHAR(36) NOT NULL,
  `accepted_by_user_id` VARCHAR(36) NULL,
  `email` VARCHAR(255) NOT NULL,
  `role` ENUM('primary_manager', 'manager', 'operator') NOT NULL,
  `token_hash` VARCHAR(128) NOT NULL,
  `status` ENUM('pending', 'accepted', 'revoked', 'expired') NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME(6) NOT NULL,
  `accepted_at` DATETIME(6) NULL,
  `revoked_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `organization_invitations_token_hash_key`(`token_hash`),
  INDEX `organization_invitations_organization_id_status_expires_at_idx`(`organization_id`, `status`, `expires_at`),
  INDEX `organization_invitations_organization_id_email_status_idx`(`organization_id`, `email`, `status`),
  INDEX `organization_invitations_email_status_expires_at_idx`(`email`, `status`, `expires_at`),
  INDEX `organization_invitations_invited_by_user_id_created_at_idx`(`invited_by_user_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `users`
  ADD INDEX `users_preferred_organization_id_idx`(`preferred_organization_id`);

ALTER TABLE `organization_memberships`
  ADD CONSTRAINT `organization_memberships_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `organization_memberships_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `organization_invitations`
  ADD CONSTRAINT `organization_invitations_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `organization_invitations_invited_by_user_id_fkey`
    FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `organization_invitations_accepted_by_user_id_fkey`
    FOREIGN KEY (`accepted_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `users`
  ADD CONSTRAINT `users_preferred_organization_id_fkey`
    FOREIGN KEY (`preferred_organization_id`) REFERENCES `organizations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TEMPORARY TABLE `owner_organization_backfill` (
  `owner_user_id` VARCHAR(36) NOT NULL,
  `organization_id` VARCHAR(36) NOT NULL,
  `organization_name` VARCHAR(160) NOT NULL,
  PRIMARY KEY (`owner_user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `owner_organization_backfill` (`owner_user_id`, `organization_id`, `organization_name`)
SELECT
  `u`.`id`,
  UUID(),
  CASE
    WHEN LENGTH(TRIM(CONCAT_WS(' ', NULLIF(TRIM(`u`.`first_name`), ''), NULLIF(TRIM(`u`.`last_name`), '')))) > 0
      THEN CONCAT(TRIM(CONCAT_WS(' ', NULLIF(TRIM(`u`.`first_name`), ''), NULLIF(TRIM(`u`.`last_name`), ''))), ' Organization')
    WHEN `p`.`username` IS NOT NULL AND LENGTH(TRIM(`p`.`username`)) > 0
      THEN CONCAT(TRIM(`p`.`username`), ' Organization')
    ELSE CONCAT(SUBSTRING_INDEX(`u`.`email`, '@', 1), ' Organization')
  END
FROM `users` `u`
LEFT JOIN `profiles` `p` ON `p`.`user_id` = `u`.`id`
WHERE `u`.`role` = 'owner';

INSERT INTO `organizations` (`id`, `name`, `created_at`, `updated_at`)
SELECT
  `organization_id`,
  `organization_name`,
  NOW(6),
  NOW(6)
FROM `owner_organization_backfill`;

INSERT INTO `organization_memberships` (`id`, `organization_id`, `user_id`, `role`, `created_at`, `updated_at`)
SELECT
  UUID(),
  `organization_id`,
  `owner_user_id`,
  'primary_manager',
  NOW(6),
  NOW(6)
FROM `owner_organization_backfill`;

UPDATE `users` `u`
INNER JOIN `owner_organization_backfill` `backfill`
  ON `backfill`.`owner_user_id` = `u`.`id`
SET `u`.`preferred_organization_id` = `backfill`.`organization_id`
WHERE `u`.`role` = 'owner';

DROP TEMPORARY TABLE `owner_organization_backfill`;
