-- Reject images the moderation provider refuses to analyze with their own code.
--
-- `unscreenable` means Content Safety answered a request for one image with a
-- client error other than throttling or refused credentials, such as a 400.
-- Asking again would get the same answer, so the item is rejected rather than
-- retried and dead-lettered as `processing_failed`, which a replay could
-- never fix.

-- AlterTable
ALTER TABLE `media` MODIFY `rejection_code` ENUM('empty', 'too_large', 'unsupported_type', 'type_mismatch', 'dimensions', 'corrupt', 'animated', 'upload_changed', 'missing_upload', 'processing_failed', 'abandoned', 'malware', 'moderation', 'unscreenable') NULL;
