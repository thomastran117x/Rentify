ALTER TABLE `rentings`
    MODIFY `status` ENUM(
        'confirmed',
        'check_in_ready',
        'active',
        'return_due',
        'completed',
        'disputed',
        'cancelled'
    ) NOT NULL,
    ADD COLUMN `pickup_instructions` VARCHAR(1000) NULL,
    ADD COLUMN `return_instructions` VARCHAR(1000) NULL,
    ADD COLUMN `check_in_ready_at` DATETIME(6) NULL,
    ADD COLUMN `check_in_completed_at` DATETIME(6) NULL,
    ADD COLUMN `return_due_at` DATETIME(6) NULL,
    ADD COLUMN `completed_at` DATETIME(6) NULL,
    ADD COLUMN `disputed_at` DATETIME(6) NULL,
    ADD COLUMN `cancelled_at` DATETIME(6) NULL;

CREATE TABLE `renting_disputes` (
    `id` VARCHAR(36) NOT NULL,
    `renting_id` VARCHAR(36) NOT NULL,
    `opened_by_user_id` VARCHAR(36) NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `details` VARCHAR(2000) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `renting_disputes_renting_id_key`(`renting_id`),
    INDEX `renting_disputes_opened_by_user_id_created_at_idx`(`opened_by_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `renting_disputes`
    ADD CONSTRAINT `renting_disputes_renting_id_fkey`
        FOREIGN KEY (`renting_id`) REFERENCES `rentings`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `renting_disputes_opened_by_user_id_fkey`
        FOREIGN KEY (`opened_by_user_id`) REFERENCES `users`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE;
