-- Single-use recovery codes for accounts with an authenticator app.
--
-- Only a keyed hash of each code is stored. Used rows stay until the set is
-- replaced, so "every code was used" reads differently from "no codes were ever
-- generated". The table is new, so an instance still running the previous
-- release is unaffected.

-- CreateTable
CREATE TABLE `user_mfa_recovery_codes` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `code_hash` VARCHAR(64) NOT NULL,
    `used_at` DATETIME(6) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `user_mfa_recovery_codes_user_id_code_hash_key`(`user_id`, `code_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_mfa_recovery_codes` ADD CONSTRAINT `user_mfa_recovery_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
