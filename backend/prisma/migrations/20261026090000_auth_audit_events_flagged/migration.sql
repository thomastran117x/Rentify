-- Flag auth audit events that suspicious sign-in detection acted on.
--
-- The detector marks the events behind each security.suspicious_activity
-- event, and that event itself, so administrators can search for
-- flagged = true. The admin search puts each equality filter ahead of
-- created_at, so the new index follows the same shape. The column defaults to
-- false, so existing rows and an instance still running the previous release,
-- which never writes it, are unaffected. InnoDB adds the column and builds the
-- index online, so writes to the table continue while they are created.

-- AlterTable
ALTER TABLE `auth_audit_events` ADD COLUMN `flagged` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `auth_audit_events_flagged_created_at_idx` ON `auth_audit_events`(`flagged`, `created_at`);
