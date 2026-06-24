-- DropIndex
DROP INDEX `posting_search_outbox_available_at_processed_at_processing_a_idx` ON `posting_search_outbox`;

-- AlterTable
ALTER TABLE `booking_requests` ALTER COLUMN `contact_name` DROP DEFAULT,
    ALTER COLUMN `contact_email` DROP DEFAULT;

-- AlterTable
ALTER TABLE `content_report_search_outbox` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `content_reports` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `feedback` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `payment_attempts` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `payments` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `payouts` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `popular_recommendation_snapshots` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `posting_search_outbox` MODIFY `operation` ENUM('upsert', 'delete', 'barrier') NOT NULL,
    ALTER COLUMN `dedupe_key` DROP DEFAULT;

-- AlterTable
ALTER TABLE `recommendation_activities` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `recommendation_refresh_jobs` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `refunds` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `renting_disputes` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `search_reindex_runs` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `user_recommendation_profiles` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `user_recommendation_snapshots` ALTER COLUMN `updated_at` DROP DEFAULT;

-- CreateTable
CREATE TABLE `user_mfa_totp` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `secret_encrypted` TEXT NOT NULL,
    `status` ENUM('pending', 'active') NOT NULL DEFAULT 'pending',
    `expires_at` DATETIME(6) NULL,
    `last_used_counter` BIGINT NULL,
    `confirmed_at` DATETIME(6) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL,

    UNIQUE INDEX `user_mfa_totp_user_id_key`(`user_id`),
    INDEX `user_mfa_totp_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_flags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `description` TEXT NULL,
    `group` VARCHAR(100) NULL,
    `created_by_user_id` VARCHAR(36) NULL,
    `updated_by_user_id` VARCHAR(36) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL,

    UNIQUE INDEX `feature_flags_name_key`(`name`),
    INDEX `feature_flags_group_idx`(`group`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_flag_audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `flag_name` VARCHAR(255) NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `old_enabled` BOOLEAN NULL,
    `new_enabled` BOOLEAN NULL,
    `old_description` TEXT NULL,
    `new_description` TEXT NULL,
    `old_group` VARCHAR(100) NULL,
    `new_group` VARCHAR(100) NULL,
    `actor_user_id` VARCHAR(36) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `feature_flag_audit_logs_flag_name_created_at_idx`(`flag_name`, `created_at`),
    INDEX `feature_flag_audit_logs_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_mfa_totp` ADD CONSTRAINT `user_mfa_totp_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `posting_availability_blocks` RENAME INDEX `posting_availability_blocks_posting_id_source_start_at_end_idx` TO `posting_availability_blocks_posting_id_source_start_at_end_a_idx`;

-- RenameIndex
ALTER TABLE `recommendation_activities` RENAME INDEX `recommendation_activities_actor_personalization_last_idx` TO `recommendation_activities_actor_user_id_personalization_elig_idx`;

-- RenameIndex
ALTER TABLE `recommendation_activities` RENAME INDEX `recommendation_activities_anonymous_event_last_idx` TO `recommendation_activities_anonymous_actor_hash_event_type_la_idx`;

-- RenameIndex
ALTER TABLE `recommendation_activities` RENAME INDEX `recommendation_activities_posting_event_last_idx` TO `recommendation_activities_posting_id_event_type_last_occurre_idx`;

-- RenameIndex
ALTER TABLE `recommendation_refresh_jobs` RENAME INDEX `recommendation_refresh_jobs_job_segment_idx` TO `recommendation_refresh_jobs_job_type_segment_type_segment_va_idx`;

-- RenameIndex
ALTER TABLE `recommendation_refresh_jobs` RENAME INDEX `recommendation_refresh_jobs_job_user_idx` TO `recommendation_refresh_jobs_job_type_user_id_idx`;
