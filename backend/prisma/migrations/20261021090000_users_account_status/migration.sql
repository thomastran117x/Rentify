-- Durable account status.
--
-- users.status is active, locked or suspended. locked is a security hold the
-- user can clear with a password reset; suspended is a policy action only an
-- admin can reverse. Every sign-in and every access-token, refresh and
-- personal-access-token check rejects a status other than active.
--
-- status defaults to 'active', so every existing user is active and there is
-- nothing to backfill. status_changed_by holds the admin's id, or NULL for the
-- system or the user, with no foreign key so the record survives the admin's
-- account being deleted. The change is additive, so an instance still running
-- the previous release is unaffected: it never reads the new columns.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    ADD COLUMN `status_reason` VARCHAR(255) NULL,
    ADD COLUMN `status_changed_at` DATETIME(6) NULL,
    ADD COLUMN `status_changed_by` VARCHAR(36) NULL;
