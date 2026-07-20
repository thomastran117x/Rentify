-- CreateTable
CREATE TABLE `organization_blog_search_reindex_runs` (
    `id` VARCHAR(36) NOT NULL,
    `status` ENUM('pending', 'running', 'waiting_for_catchup', 'completed', 'failed') NOT NULL,
    `target_index_name` VARCHAR(191) NOT NULL,
    `retained_index_name` VARCHAR(191) NULL,
    `source_snapshot_at` DATETIME(6) NOT NULL,
    `barrier_outbox_id` VARCHAR(36) NULL,
    `total_documents` INTEGER NOT NULL DEFAULT 0,
    `indexed_documents` INTEGER NOT NULL DEFAULT 0,
    `failed_documents` INTEGER NOT NULL DEFAULT 0,
    `started_at` DATETIME(6) NULL,
    `completed_at` DATETIME(6) NULL,
    `failed_at` DATETIME(6) NULL,
    `processing_at` DATETIME(6) NULL,
    `last_error` VARCHAR(2048) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `organization_blog_search_reindex_runs_barrier_outbox_id_key`(`barrier_outbox_id`),
    INDEX `organization_blog_search_reindex_runs_status_created_at_idx`(`status`, `created_at`),
    INDEX `organization_blog_search_reindex_runs_processing_at_status_idx`(`processing_at`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organization_blog_search_outbox` (
    `id` VARCHAR(36) NOT NULL,
    `blog_post_id` VARCHAR(36) NULL,
    `reindex_run_id` VARCHAR(36) NULL,
    `operation` ENUM('upsert', 'delete', 'barrier') NOT NULL,
    `dedupe_key` VARCHAR(255) NOT NULL,
    `target_index_name` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `publish_attempts` INTEGER NOT NULL DEFAULT 0,
    `available_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `processing_at` DATETIME(6) NULL,
    `processed_at` DATETIME(6) NULL,
    `indexed_at` DATETIME(6) NULL,
    `dead_lettered_at` DATETIME(6) NULL,
    `broker_message_id` VARCHAR(255) NULL,
    `last_error` VARCHAR(2048) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL,

    INDEX `obs_outbox_ready_idx`(`available_at`, `processed_at`, `dead_lettered_at`, `processing_at`),
    INDEX `organization_blog_search_outbox_blog_post_id_operation_idx`(`blog_post_id`, `operation`),
    INDEX `obs_outbox_reindex_idx`(`reindex_run_id`, `indexed_at`, `dead_lettered_at`),
    INDEX `obs_outbox_target_idx`(`target_index_name`, `indexed_at`, `dead_lettered_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- NOTE: `blog_post_id` is intentionally NOT a foreign key. A "delete" outbox row
-- must outlive the blog post it removes from the index, so the id is stored as a
-- plain column rather than an FK that would cascade the row away on post delete.

-- AddForeignKey
ALTER TABLE `organization_blog_search_outbox` ADD CONSTRAINT `organization_blog_search_outbox_reindex_run_id_fkey` FOREIGN KEY (`reindex_run_id`) REFERENCES `organization_blog_search_reindex_runs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
