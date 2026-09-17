-- Embedded checkout: each attempt records the method the renter chose and the
-- PayPal order it created, so superseded orders stay traceable.
ALTER TABLE `payment_attempts`
  ADD COLUMN `provider_order_id` VARCHAR(128) NULL AFTER `provider_payment_id`,
  ADD COLUMN `payment_method` VARCHAR(32) NULL AFTER `provider_order_id`;

CREATE INDEX `payment_attempts_provider_order_id_idx` ON `payment_attempts`(`provider_order_id`);
