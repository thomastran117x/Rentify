-- CreateTable
CREATE TABLE `booking_messages` (
  `id` VARCHAR(36) NOT NULL,
  `booking_request_id` VARCHAR(36) NOT NULL,
  `author_id` VARCHAR(36) NOT NULL,
  `body` VARCHAR(2000) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `read_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  INDEX `booking_messages_booking_request_id_created_at_idx`(`booking_request_id`, `created_at`),
  INDEX `booking_messages_booking_request_id_read_at_author_id_idx`(`booking_request_id`, `read_at`, `author_id`),
  INDEX `booking_messages_author_id_idx`(`author_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `booking_messages`
  ADD CONSTRAINT `booking_messages_booking_request_id_fkey`
  FOREIGN KEY (`booking_request_id`) REFERENCES `booking_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `booking_messages_author_id_fkey`
  FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
