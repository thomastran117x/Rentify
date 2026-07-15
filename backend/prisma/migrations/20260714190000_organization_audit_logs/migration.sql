CREATE TABLE `organization_audit_logs` (
  `id` VARCHAR(36) NOT NULL,
  `organization_id` VARCHAR(36) NOT NULL,
  `actor_user_id` VARCHAR(36) NULL,
  `action` VARCHAR(80) NOT NULL,
  `resource_type` VARCHAR(60) NOT NULL,
  `resource_id` VARCHAR(64) NULL,
  `organization_version` INTEGER NOT NULL,
  `resource_version` INTEGER NULL,
  `summary` VARCHAR(255) NOT NULL,
  `changes` JSON NULL,
  `before_snapshot` JSON NULL,
  `after_snapshot` JSON NULL,
  `restorable` BOOLEAN NOT NULL DEFAULT false,
  `restored_from_audit_id` VARCHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  INDEX `organization_audit_logs_organization_id_created_at_idx`(`organization_id`, `created_at`),
  INDEX `organization_audit_logs_organization_id_organization_version_idx`(`organization_id`, `organization_version`),
  INDEX `org_audit_resource_version_idx`(`organization_id`, `resource_type`, `resource_id`, `resource_version`),
  INDEX `organization_audit_logs_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `organization_audit_logs`
  ADD CONSTRAINT `organization_audit_logs_organization_id_fkey`
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `organization_audit_logs_actor_user_id_fkey`
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
