-- The links that undo a completed email change.
--
-- Each `email_changed` email carries one, valid for seven days, and while it
-- is open the old address stays reserved for it. They live here rather than in
-- Redis because a link can be an owner's only way back into a taken-over
-- account for a week, so it has to survive a cache flush. Only the token's
-- hash is stored. The table is new, so an instance still running the previous
-- release is unaffected.

-- CreateTable
CREATE TABLE `email_change_reverts` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `old_email` VARCHAR(255) NOT NULL,
    `new_email` VARCHAR(255) NOT NULL,
    `source_event_id` VARCHAR(36) NOT NULL,
    `expires_at` DATETIME(6) NOT NULL,
    `consumed_at` DATETIME(6) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `email_change_reverts_token_hash_key`(`token_hash`),
    INDEX `email_change_reverts_old_email_expires_at_idx`(`old_email`, `expires_at`),
    INDEX `email_change_reverts_user_id_consumed_at_idx`(`user_id`, `consumed_at`),
    INDEX `email_change_reverts_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `email_change_reverts` ADD CONSTRAINT `email_change_reverts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
