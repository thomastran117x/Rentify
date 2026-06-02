ALTER TABLE `booking_requests`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

ALTER TABLE `rentings`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

ALTER TABLE `payments`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

ALTER TABLE `payouts`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

ALTER TABLE `posting_view_events`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

ALTER TABLE `posting_analytics_unique_views`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

ALTER TABLE `posting_analytics_hourly`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

ALTER TABLE `posting_analytics_daily`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

ALTER TABLE `posting_analytics_outbox`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

ALTER TABLE `recommendation_activities`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

UPDATE `booking_requests` `booking`
INNER JOIN `postings` `posting`
  ON `posting`.`id` = `booking`.`posting_id`
SET `booking`.`organization_id` = `posting`.`organization_id`
WHERE `booking`.`organization_id` IS NULL;

UPDATE `rentings` `renting`
INNER JOIN `booking_requests` `booking`
  ON `booking`.`id` = `renting`.`booking_request_id`
SET `renting`.`organization_id` = `booking`.`organization_id`
WHERE `renting`.`organization_id` IS NULL;

UPDATE `payments` `payment`
INNER JOIN `booking_requests` `booking`
  ON `booking`.`id` = `payment`.`booking_request_id`
SET `payment`.`organization_id` = `booking`.`organization_id`
WHERE `payment`.`organization_id` IS NULL;

UPDATE `payouts` `payout`
INNER JOIN `payments` `payment`
  ON `payment`.`id` = `payout`.`payment_id`
SET `payout`.`organization_id` = `payment`.`organization_id`
WHERE `payout`.`organization_id` IS NULL;

UPDATE `posting_view_events` `event`
INNER JOIN `postings` `posting`
  ON `posting`.`id` = `event`.`posting_id`
SET `event`.`organization_id` = `posting`.`organization_id`
WHERE `event`.`organization_id` IS NULL;

UPDATE `posting_analytics_unique_views` `unique_view`
INNER JOIN `postings` `posting`
  ON `posting`.`id` = `unique_view`.`posting_id`
SET `unique_view`.`organization_id` = `posting`.`organization_id`
WHERE `unique_view`.`organization_id` IS NULL;

UPDATE `posting_analytics_hourly` `hourly`
INNER JOIN `postings` `posting`
  ON `posting`.`id` = `hourly`.`posting_id`
SET `hourly`.`organization_id` = `posting`.`organization_id`
WHERE `hourly`.`organization_id` IS NULL;

UPDATE `posting_analytics_daily` `daily`
INNER JOIN `postings` `posting`
  ON `posting`.`id` = `daily`.`posting_id`
SET `daily`.`organization_id` = `posting`.`organization_id`
WHERE `daily`.`organization_id` IS NULL;

UPDATE `posting_analytics_outbox` `outbox`
INNER JOIN `postings` `posting`
  ON `posting`.`id` = `outbox`.`posting_id`
SET `outbox`.`organization_id` = `posting`.`organization_id`
WHERE `outbox`.`organization_id` IS NULL;

UPDATE `recommendation_activities` `activity`
INNER JOIN `postings` `posting`
  ON `posting`.`id` = `activity`.`posting_id`
SET `activity`.`organization_id` = `posting`.`organization_id`
WHERE `activity`.`organization_id` IS NULL;

ALTER TABLE `booking_requests`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `booking_requests_organization_id_status_created_at_idx`(`organization_id`, `status`, `created_at`),
  ADD CONSTRAINT `booking_requests_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `rentings`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `rentings_organization_id_status_created_at_idx`(`organization_id`, `status`, `created_at`),
  ADD CONSTRAINT `rentings_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `payments`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `payments_organization_id_status_created_at_idx`(`organization_id`, `status`, `created_at`),
  ADD CONSTRAINT `payments_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `payouts`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `payouts_organization_id_status_due_at_idx`(`organization_id`, `status`, `due_at`),
  ADD CONSTRAINT `payouts_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `posting_view_events`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `posting_view_events_organization_id_event_date_idx`(`organization_id`, `event_date`),
  ADD CONSTRAINT `posting_view_events_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `posting_analytics_unique_views`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `posting_analytics_unique_views_organization_id_event_date_idx`(`organization_id`, `event_date`);

ALTER TABLE `posting_analytics_hourly`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `posting_analytics_hourly_organization_id_bucket_start_idx`(`organization_id`, `bucket_start`),
  ADD CONSTRAINT `posting_analytics_hourly_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `posting_analytics_daily`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `posting_analytics_daily_organization_id_bucket_start_idx`(`organization_id`, `bucket_start`),
  ADD CONSTRAINT `posting_analytics_daily_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `posting_analytics_outbox`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `posting_analytics_outbox_organization_id_event_type_idx`(`organization_id`, `event_type`),
  ADD CONSTRAINT `posting_analytics_outbox_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `recommendation_activities`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `rec_act_org_evt_last_idx`(`organization_id`, `event_type`, `last_occurred_at`),
  ADD CONSTRAINT `recommendation_activities_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
