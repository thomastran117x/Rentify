-- Recently viewed postings.
--
-- A visitor who opened a listing yesterday and wants it back today has no route
-- to it: they did not save it, and the search that surfaced it is gone. The
-- database already watches views -- `posting_view_events` and
-- `recommendation_activities` are both written on `GET /postings/:id` -- but
-- neither can answer "what did *I* look at": the first is indexed by posting for
-- owner analytics and never by user, and the second aggregates, dedupes, and is
-- gated on personalization consent. This table is that route.
--
-- One row per (`user_id`, `posting_id`), with `viewed_at` bumped on every
-- re-open, rather than a row per view. "Recently viewed" is a set of distinct
-- postings ordered by last view; an append-only log would render the same
-- listing five times after five refreshes, and de-duplicating it at read time
-- would need GROUP BY ... MAX(viewed_at), which no index serves. It would also
-- make retention count views instead of postings, so one visitor refreshing a
-- single page could consume their whole history budget.
--
-- This is the deliberate opposite of `saved_postings`, whose upsert preserves
-- `created_at` so that re-saving does not reorder a wishlist. Here re-viewing
-- *is* the signal, so `viewed_at` moves and `created_at` is kept as the first
-- view. Signed-out visitors keep the same list in localStorage; merging that
-- mirror on sign-in takes GREATEST(viewed_at, incoming) so a device that has
-- been closed for a week can never demote a row another device refreshed this
-- morning.
--
-- (`user_id`, `viewed_at`) is the list index: the only read is
-- "WHERE user_id = ? ORDER BY viewed_at DESC LIMIT n", a backward index scan
-- with no filesort. (`user_id`, `posting_id`) is UNIQUE, which is what makes the
-- write an upsert and the single-entry delete a point lookup. (`posting_id`)
-- mirrors `saved_postings` and keeps the posting-side cascade delete off a
-- table scan.
--
-- This is browsing history, so retention is bounded by construction rather than
-- by policy: the write path prunes each account back to the newest 50 rows, and
-- the visitor can delete one entry or clear the lot. There is no sweeper,
-- deliberately -- the repository has no scheduled-job infrastructure and a count
-- cap does not justify inventing one, the same call `saved_search_seen_postings`
-- already makes.

-- CreateTable
CREATE TABLE `recently_viewed_postings` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `posting_id` VARCHAR(36) NOT NULL,
  `viewed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `recently_viewed_postings_user_id_posting_id_key`(`user_id`, `posting_id`),
  INDEX `recently_viewed_postings_user_id_viewed_at_idx`(`user_id`, `viewed_at`),
  INDEX `recently_viewed_postings_posting_id_idx`(`posting_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `recently_viewed_postings`
  ADD CONSTRAINT `recently_viewed_postings_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `recently_viewed_postings_posting_id_fkey`
  FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Opting out of the history above.
--
-- Recording what someone browsed needs an off switch, and it belongs beside
-- `recommendation_personalization_enabled` rather than in a new preferences
-- table: it is the same kind of flag, read on the same paths, and the profile
-- row already loads on every session refresh. Defaulting to true keeps the
-- feature on for existing accounts, which is the behaviour they get today
-- anyway -- nothing was recorded before this migration, so there is no back
-- history to expose. Turning it off stops recording; it does not delete what is
-- already there, which is what the clear-history endpoint is for.
ALTER TABLE `profiles`
  ADD COLUMN `recently_viewed_tracking_enabled` BOOLEAN NOT NULL DEFAULT true;
