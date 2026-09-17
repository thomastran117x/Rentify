-- Replace Square with PayPal. Provider references move to provider-neutral
-- columns; Square's location has no PayPal equivalent and is dropped.

-- Widen, migrate, then narrow each provider enum so existing rows stay valid.
ALTER TABLE `payments` MODIFY `provider` ENUM('square', 'paypal') NOT NULL;
UPDATE `payments` SET `provider` = 'paypal';
ALTER TABLE `payments` MODIFY `provider` ENUM('paypal') NOT NULL;

ALTER TABLE `payment_webhook_events` MODIFY `provider` ENUM('square', 'paypal') NOT NULL;
UPDATE `payment_webhook_events` SET `provider` = 'paypal';
ALTER TABLE `payment_webhook_events` MODIFY `provider` ENUM('paypal') NOT NULL;

ALTER TABLE `payments`
  RENAME COLUMN `square_payment_id` TO `provider_payment_id`,
  RENAME COLUMN `square_order_id` TO `provider_order_id`,
  DROP COLUMN `square_location_id`,
  RENAME INDEX `payments_square_payment_id_key` TO `payments_provider_payment_id_key`,
  RENAME INDEX `payments_square_order_id_key` TO `payments_provider_order_id_key`;

ALTER TABLE `payment_attempts`
  RENAME COLUMN `square_payment_id` TO `provider_payment_id`;

ALTER TABLE `refunds`
  RENAME COLUMN `square_refund_id` TO `provider_refund_id`,
  RENAME INDEX `refunds_square_refund_id_key` TO `refunds_provider_refund_id_key`;

ALTER TABLE `payouts`
  RENAME COLUMN `square_payout_id` TO `provider_payout_id`,
  RENAME INDEX `payouts_square_payout_id_key` TO `payouts_provider_payout_id_key`;
