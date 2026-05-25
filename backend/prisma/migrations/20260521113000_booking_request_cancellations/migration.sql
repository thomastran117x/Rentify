ALTER TABLE `booking_requests`
  ADD COLUMN `cancelled_by_user_id` VARCHAR(36) NULL AFTER `cancelled_at`,
  ADD COLUMN `cancellation_actor` ENUM('renter', 'owner') NULL AFTER `cancelled_by_user_id`,
  ADD COLUMN `cancellation_reason` VARCHAR(1000) NULL AFTER `cancellation_actor`,
  ADD COLUMN `cancellation_policy_code` VARCHAR(100) NULL AFTER `cancellation_reason`,
  ADD COLUMN `cancellation_refund_amount` DECIMAL(18, 2) NULL AFTER `cancellation_policy_code`;
