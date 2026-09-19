-- Uploaded media.
--
-- Until now an upload existed only as a blob: `POST /blob/upload-url` signed a
-- URL, the client PUT the bytes, and nothing was recorded until a feature saved
-- the resulting URL. On the Azure path the backend never saw those bytes, so a
-- stored "image" was whatever the client chose to send.
--
-- A row is now written *before* the upload credential is signed, and the
-- client uploads to `original_blob_name`, a `quarantine/images/<user>/<id>`
-- name that is never served. The media processing worker decodes and
-- re-encodes the bytes into `processed_blob_name`
-- (`media/images/<user>/<id>.webp`) and moves the row to `ready`, or records a
-- `rejection_reason` and moves it to `rejected`. Features attach images by id,
-- and only a `ready` row resolves to something displayable.
--
-- The blob names, not URLs, are stored: a URL is derived from the name and the
-- configured storage account, and would go stale if either moved.
--
-- `scope` keeps the upload purpose the client declared (`postings`,
-- `organizations`, ...). It used to be the first segment of the blob name,
-- which is where the organization-logo and blog-cover rules read it from; the
-- new names no longer encode it.
--
-- Both blob name columns are VARCHAR(255) rather than the 1024 used elsewhere:
-- they are UNIQUE, and a 1024-character utf8mb4 column is past InnoDB's
-- 3072-byte index key limit. The names are about 90 characters.
--
-- (`user_id`, `status`) serves per-user lookups; (`status`, `updated_at`)
-- serves the cleanup of rows abandoned before they reached `ready`.

-- CreateTable
CREATE TABLE `media` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `status` ENUM('pending_upload', 'uploaded', 'processing', 'ready', 'rejected') NOT NULL DEFAULT 'pending_upload',
  `scope` VARCHAR(100) NOT NULL,
  `original_blob_name` VARCHAR(255) NOT NULL,
  `processed_blob_name` VARCHAR(255) NULL,
  `declared_content_type` VARCHAR(100) NOT NULL,
  `detected_content_type` VARCHAR(100) NULL,
  `original_filename` VARCHAR(255) NULL,
  `size_bytes` INTEGER NULL,
  `width` INTEGER NULL,
  `height` INTEGER NULL,
  `rejection_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL,
  UNIQUE INDEX `media_original_blob_name_key`(`original_blob_name`),
  UNIQUE INDEX `media_processed_blob_name_key`(`processed_blob_name`),
  INDEX `media_user_id_status_idx`(`user_id`, `status`),
  INDEX `media_status_updated_at_idx`(`status`, `updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `media`
  ADD CONSTRAINT `media_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
