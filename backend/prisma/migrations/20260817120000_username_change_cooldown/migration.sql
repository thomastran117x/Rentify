-- Username change cooldown.
--
-- Usernames are public identity: they appear on profiles, postings and booking
-- message threads, and they are the handle used to sign in and to recover an
-- account. Until now a rename was unrestricted, so a name could be churned
-- repeatedly to shed a reputation, and a freed name could be re-claimed by
-- anyone immediately. `username_changed_at` anchors a 30-day cooldown between
-- renames.
--
-- Both columns are nullable/defaulted so this applies cleanly to a populated
-- database with no backfill step.
--
-- `username_changed_at` IS NULL means "no cooldown in effect". Every existing
-- row is left NULL deliberately: nobody is locked out by the deploy, and each
-- account keeps one free change, after which the clock starts.
--
-- `username_auto_generated` marks a profile whose username was derived from the
-- OAuth email local part rather than chosen by the person (see
-- AuthRepository.generateAvailableUsername). Replacing such a name is a *claim*,
-- not a *change*, so it clears this flag without starting the cooldown. Existing
-- OAuth accounts are deliberately NOT backfilled to true: they have had
-- unrestricted renames until now, and the NULL clock above already grants them a
-- free change. Only accounts created after this migration get the claim
-- exemption.

-- AlterTable
ALTER TABLE `profiles`
  ADD COLUMN `username_changed_at` DATETIME(6) NULL,
  ADD COLUMN `username_auto_generated` BOOLEAN NOT NULL DEFAULT false;
