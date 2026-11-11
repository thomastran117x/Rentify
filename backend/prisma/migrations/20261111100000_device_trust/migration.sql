-- "Remember this device".
--
-- Login MFA is skipped for a bound device while trusted_until is in the future
-- and trusted_token_version still matches the account's token version, so a
-- password change, signing out everywhere or a lock ends trust without
-- touching these rows. Both columns are nullable and unread by the previous
-- release, so an instance still running it is unaffected.

-- AlterTable
ALTER TABLE `devices` ADD COLUMN `trusted_until` DATETIME(6) NULL,
    ADD COLUMN `trusted_token_version` INTEGER NULL;
