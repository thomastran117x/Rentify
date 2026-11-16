-- Pin "Remember this device" to the account's MFA factor set.
--
-- users.mfa_factor_version is bumped in the same transaction as every
-- passkey or authenticator change, and trust counts only while
-- devices.trusted_mfa_version still matches it. A trust grant that races a
-- factor change therefore cannot outlive it, however the writes interleave.
-- Trust granted before this migration has no trusted_mfa_version and stops
-- counting, which only means one more code at the next sign-in.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `mfa_factor_version` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `devices` ADD COLUMN `trusted_mfa_version` INTEGER NULL;
