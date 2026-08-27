-- Saved posting searches with new-match alerts.
--
-- A visitor who searches for something that is not listed yet has no way of
-- learning that it later became available. `saved_searches` persists the
-- filter set they ran so a background sweep can replay it and email them.
--
-- `query_params` stores the validated public search input minus `page`,
-- `pageSize` and `sort`, which are presentation concerns the sweep chooses for
-- itself. It is JSON rather than a column per filter because the filter set is
-- large, sparse, and still growing; the schema of record stays the zod schema
-- the live search endpoint already validates against, and `invalidated_at`
-- marks the rows that stop parsing after that schema changes.
--
-- `query_hash` is a sha256 over the canonicalised params. The unique index on
-- (`user_id`, `query_hash`) is what stops a visitor accumulating a dozen
-- copies of the same search by pressing save twice.
--
-- `next_check_at` is NULL exactly when `notify_frequency` = 'off', so the
-- (`notify_frequency`, `next_check_at`) index serves the worker's claim query
-- without scanning the searches that never alert.
--
-- `saved_search_seen_postings` records which postings a search has already
-- alerted on. Tracking the set, rather than a "published after" cutoff, is
-- what lets an unpaused listing or a freshly-opened date window count as a new
-- match: those postings are not new, but they are new *to this search*.

-- CreateTable
CREATE TABLE `saved_searches` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `query_params` JSON NOT NULL,
  `query_hash` CHAR(64) NOT NULL,
  `notify_frequency` ENUM('instant', 'daily', 'off') NOT NULL DEFAULT 'instant',
  `next_check_at` DATETIME(6) NULL,
  `last_checked_at` DATETIME(6) NULL,
  `last_notified_at` DATETIME(6) NULL,
  `new_match_count` INTEGER NOT NULL DEFAULT 0,
  `invalidated_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `saved_searches_user_id_query_hash_key`(`user_id`, `query_hash`),
  INDEX `saved_searches_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `saved_searches_notify_frequency_next_check_at_idx`(`notify_frequency`, `next_check_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `saved_search_seen_postings` (
  `id` VARCHAR(36) NOT NULL,
  `saved_search_id` VARCHAR(36) NOT NULL,
  `posting_id` VARCHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `saved_search_seen_postings_search_posting_key`(`saved_search_id`, `posting_id`),
  INDEX `saved_search_seen_postings_search_created_idx`(`saved_search_id`, `created_at`),
  INDEX `saved_search_seen_postings_posting_id_idx`(`posting_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `saved_searches`
  ADD CONSTRAINT `saved_searches_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `saved_search_seen_postings`
  ADD CONSTRAINT `saved_search_seen_postings_saved_search_id_fkey`
  FOREIGN KEY (`saved_search_id`) REFERENCES `saved_searches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `saved_search_seen_postings_posting_id_fkey`
  FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
