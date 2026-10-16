-- Record authentication activity.
--
-- auth_audit_events holds one row per sign-in outcome, unlock and sign-out,
-- written by AuthAuditService.recordSafely. The typed sign-in identifier is
-- stored only as an HMAC (identifier_hash), never in the clear. user_id is null
-- when the identifier matched no account, and is nulled when the account is
-- deleted, so the history outlives the user. Rows are ordered by created_at,
-- not by insert order.
--
-- users.last_login_at is new and nullable. Existing users keep NULL until
-- their next sign-in; there is nothing to backfill it from. Both changes are
-- additive, so an instance still running the previous release is unaffected.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `last_login_at` DATETIME(6) NULL;

-- CreateTable
CREATE TABLE `auth_audit_events` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NULL,
    `actor_user_id` VARCHAR(36) NULL,
    `event_type` VARCHAR(80) NOT NULL,
    `outcome` VARCHAR(16) NOT NULL,
    `reason_code` VARCHAR(60) NULL,
    `method` VARCHAR(20) NULL,
    `identifier_hash` VARCHAR(64) NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(512) NULL,
    `device_id` VARCHAR(64) NULL,
    `session_id` VARCHAR(64) NULL,
    `request_id` VARCHAR(64) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `auth_audit_events_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `auth_audit_events_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    INDEX `auth_audit_events_ip_address_created_at_idx`(`ip_address`, `created_at`),
    INDEX `auth_audit_events_event_type_created_at_idx`(`event_type`, `created_at`),
    INDEX `auth_audit_events_identifier_hash_created_at_idx`(`identifier_hash`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_audit_events` ADD CONSTRAINT `auth_audit_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_audit_events` ADD CONSTRAINT `auth_audit_events_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
