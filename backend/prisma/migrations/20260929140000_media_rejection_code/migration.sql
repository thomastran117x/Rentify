-- Give every media rejection a machine-readable code beside its reason.
--
-- `rejection_reason` is English text for people. `rejection_code` is what
-- metrics and clients branch on. Rows rejected before this migration keep a
-- null code.

-- AlterTable
ALTER TABLE `media` ADD COLUMN `rejection_code` ENUM('empty', 'too_large', 'unsupported_type', 'type_mismatch', 'dimensions', 'corrupt', 'animated', 'upload_changed', 'missing_upload', 'processing_failed', 'abandoned') NULL;
