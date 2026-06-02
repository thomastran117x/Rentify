ALTER TABLE `postings`
  DROP FOREIGN KEY `postings_owner_id_fkey`,
  DROP INDEX `postings_owner_id_status_idx`,
  DROP COLUMN `owner_id`;

ALTER TABLE `booking_requests`
  DROP FOREIGN KEY `booking_requests_owner_id_fkey`,
  DROP INDEX `booking_requests_owner_id_status_created_at_idx`,
  DROP COLUMN `owner_id`;

ALTER TABLE `rentings`
  DROP FOREIGN KEY `rentings_owner_id_fkey`,
  DROP INDEX `rentings_owner_id_status_created_at_idx`,
  DROP COLUMN `owner_id`;

ALTER TABLE `payments`
  DROP FOREIGN KEY `payments_owner_id_fkey`,
  DROP INDEX `payments_owner_id_status_created_at_idx`,
  DROP COLUMN `owner_id`;

ALTER TABLE `payouts`
  DROP FOREIGN KEY `payouts_owner_id_fkey`,
  DROP INDEX `payouts_owner_id_status_due_at_idx`,
  DROP COLUMN `owner_id`;

ALTER TABLE `posting_view_events`
  DROP INDEX `posting_view_events_owner_id_event_date_idx`,
  DROP COLUMN `owner_id`;

ALTER TABLE `posting_analytics_unique_views`
  DROP INDEX `posting_analytics_unique_views_owner_id_event_date_idx`,
  DROP COLUMN `owner_id`;

ALTER TABLE `posting_analytics_hourly`
  DROP INDEX `posting_analytics_hourly_owner_id_bucket_start_idx`,
  DROP COLUMN `owner_id`;

ALTER TABLE `posting_analytics_daily`
  DROP INDEX `posting_analytics_daily_owner_id_bucket_start_idx`,
  DROP COLUMN `owner_id`;

ALTER TABLE `posting_analytics_outbox`
  DROP INDEX `posting_analytics_outbox_owner_id_event_type_idx`,
  DROP COLUMN `owner_id`;

ALTER TABLE `recommendation_activities`
  DROP INDEX `recommendation_activities_owner_event_last_idx`,
  DROP COLUMN `owner_id`;
