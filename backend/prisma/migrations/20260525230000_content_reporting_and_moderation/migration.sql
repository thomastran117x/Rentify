ALTER TABLE `users`
  MODIFY `role` VARCHAR(50) NOT NULL;

CREATE TABLE `content_reports` (
  `id` VARCHAR(36) NOT NULL,
  `reporter_id` VARCHAR(36) NOT NULL,
  `subject_type` ENUM('posting', 'posting_review', 'user') NOT NULL,
  `subject_id` VARCHAR(64) NOT NULL,
  `reason_code` ENUM(
    'spam',
    'fraud_or_scam',
    'harassment_or_hate',
    'sexual_content',
    'violence_or_threats',
    'illegal_or_prohibited',
    'impersonation',
    'misleading_information',
    'review_manipulation',
    'other'
  ) NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `description` VARCHAR(2000) NOT NULL,
  `status` ENUM('open', 'under_review', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  `assigned_moderator_id` VARCHAR(36) NULL,
  `resolution_code` ENUM('action_taken', 'no_violation', 'duplicate', 'insufficient_information') NULL,
  `resolution_summary` VARCHAR(2000) NULL,
  `subject_snapshot` JSON NOT NULL,
  `subject_snapshot_text` TEXT NOT NULL,
  `reviewed_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  CONSTRAINT `content_reports_reporter_id_fkey`
    FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `content_reports_assigned_moderator_id_fkey`
    FOREIGN KEY (`assigned_moderator_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `content_report_events` (
  `id` VARCHAR(36) NOT NULL,
  `report_id` VARCHAR(36) NOT NULL,
  `actor_user_id` VARCHAR(36) NOT NULL,
  `event_type` ENUM('created', 'assigned', 'status_changed', 'note_added') NOT NULL,
  `from_status` ENUM('open', 'under_review', 'resolved', 'dismissed') NULL,
  `to_status` ENUM('open', 'under_review', 'resolved', 'dismissed') NULL,
  `assignment_user_id` VARCHAR(36) NULL,
  `note` VARCHAR(2000) NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  CONSTRAINT `content_report_events_report_id_fkey`
    FOREIGN KEY (`report_id`) REFERENCES `content_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `content_report_events_actor_user_id_fkey`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `content_report_search_outbox` (
  `id` VARCHAR(36) NOT NULL,
  `report_id` VARCHAR(36) NOT NULL,
  `operation` ENUM('upsert', 'delete') NOT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `available_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `processing_at` DATETIME(6) NULL,
  `processed_at` DATETIME(6) NULL,
  `dead_lettered_at` DATETIME(6) NULL,
  `last_error` VARCHAR(2048) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  CONSTRAINT `content_report_search_outbox_report_id_fkey`
    FOREIGN KEY (`report_id`) REFERENCES `content_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `content_reports_reporter_id_created_at_idx`
  ON `content_reports`(`reporter_id`, `created_at`);
CREATE INDEX `content_reports_status_created_at_idx`
  ON `content_reports`(`status`, `created_at`);
CREATE INDEX `content_reports_assigned_moderator_id_status_created_at_idx`
  ON `content_reports`(`assigned_moderator_id`, `status`, `created_at`);
CREATE INDEX `content_reports_subject_type_subject_id_created_at_idx`
  ON `content_reports`(`subject_type`, `subject_id`, `created_at`);

CREATE INDEX `content_report_events_report_id_created_at_idx`
  ON `content_report_events`(`report_id`, `created_at`);
CREATE INDEX `content_report_events_actor_user_id_created_at_idx`
  ON `content_report_events`(`actor_user_id`, `created_at`);

CREATE INDEX `cr_outbox_ready_idx`
  ON `content_report_search_outbox`(`available_at`, `processed_at`, `dead_lettered_at`, `processing_at`);
CREATE INDEX `content_report_search_outbox_report_id_operation_idx`
  ON `content_report_search_outbox`(`report_id`, `operation`);
