-- Optional posting expiry.
--
-- Postings have never expired. An owner listing something available only for a
-- season, for a single event, or until an item is sold had to remember to
-- archive it by hand, and a stale listing that nobody archives keeps ranking in
-- search and keeps taking booking requests the owner cannot honour.
--
-- `expires_at IS NULL` means "never expires", which is exactly the behaviour
-- every existing posting has today. No backfill runs and no live listing
-- changes state on deploy.
--
-- When the date passes on a *published* posting a sweeper moves it to the
-- existing `paused` status rather than to a new one. That reuse is the whole
-- point: `paused` already excludes a posting from every public read path and
-- from the search index (see isPostingPubliclyVisible), already lets the owner
-- settle booking requests that were in flight when the date passed, and is
-- already reversible from the dashboard. A dedicated `expired` status would
-- have duplicated all of that and forced every existing status check to learn
-- about it.
--
-- `expiry_reminder_sent_at` is the idempotency latch for the single
-- "expiring soon" email. It is stamped under an `IS NULL` predicate before the
-- job is enqueued, so two concurrent sweeps cannot both send, and it is reset
-- to NULL whenever `expires_at` changes so that moving the date re-arms exactly
-- one new reminder.

-- AlterTable
ALTER TABLE `postings`
  ADD COLUMN `expires_at` DATETIME(6) NULL,
  ADD COLUMN `expiry_reminder_sent_at` DATETIME(6) NULL;

-- CreateIndex
-- Serves both sweeps: `status` seeks, `expires_at` ranges. The reminder sweep's
-- `expiry_reminder_sent_at IS NULL` stays a residual filter on purpose -- it is
-- applied only to the few rows inside the lead-time window, and no index column
-- is usable after a range predicate anyway. Rows with a NULL `expires_at` (the
-- overwhelming majority, indefinitely) are indexed but excluded by both range
-- predicates, since `NULL <= x` is never true.
CREATE INDEX `postings_status_expires_at_idx` ON `postings`(`status`, `expires_at`);
