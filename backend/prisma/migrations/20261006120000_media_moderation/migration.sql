-- Record each processed image's visual content moderation, and reject harmful
-- images with a code.
--
-- Each processing attempt moderates the re-encoded image before any of its
-- renditions is written and sets `moderation_result`: the decision, the
-- provider, and each category's severity, for operators; no API response
-- carries it. An item becomes ready only once its current attempt has recorded
-- a result. Blocked images are rejected as `moderation`. Rows that were ready
-- before this migration keep NULL.

-- AlterTable
ALTER TABLE `media` MODIFY `rejection_code` ENUM('empty', 'too_large', 'unsupported_type', 'type_mismatch', 'dimensions', 'corrupt', 'animated', 'upload_changed', 'missing_upload', 'processing_failed', 'abandoned', 'malware', 'moderation') NULL,
    ADD COLUMN `moderation_result` JSON NULL;
