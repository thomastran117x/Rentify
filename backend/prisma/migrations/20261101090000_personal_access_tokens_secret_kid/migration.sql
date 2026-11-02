-- Record which personal-access-token key hashed each secret.
--
-- PAT secrets are HMAC-hashed with a key from PERSONAL_ACCESS_TOKEN_KEYS, and
-- a token is verified with the key named here. Existing rows were hashed with
-- PERSONAL_ACCESS_TOKEN_SECRET, which maps to kid `default`, so the column
-- defaults to it, as do the rows an instance still running the previous release
-- creates. InnoDB adds the column online, so writes to the table continue.

-- AlterTable
ALTER TABLE `personal_access_tokens` ADD COLUMN `secret_kid` VARCHAR(64) NOT NULL DEFAULT 'default';
