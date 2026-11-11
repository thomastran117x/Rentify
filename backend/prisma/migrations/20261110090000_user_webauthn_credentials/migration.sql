-- Passkeys (WebAuthn credentials) registered as a second factor.
--
-- Only the public key, counter and metadata are stored; there is nothing
-- secret here. The raw credential ID is stored as bytes so its full spec length
-- (1023 bytes) stays under the unique-index limit. The table is new, so an
-- instance still running the previous release is unaffected.

-- CreateTable
CREATE TABLE `user_webauthn_credentials` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `credential_id` VARBINARY(1023) NOT NULL,
    `public_key` BLOB NOT NULL,
    `sign_count` BIGINT NOT NULL DEFAULT 0,
    `transports` JSON NULL,
    `aaguid` CHAR(36) NOT NULL,
    `backed_up` BOOLEAN NOT NULL,
    `device_type` ENUM('single_device', 'multi_device') NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `last_used_at` DATETIME(6) NULL,

    UNIQUE INDEX `user_webauthn_credentials_credential_id_key`(`credential_id`),
    INDEX `user_webauthn_credentials_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_webauthn_credentials` ADD CONSTRAINT `user_webauthn_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
