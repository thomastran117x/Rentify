ALTER TABLE `users`
  ADD COLUMN `date_of_birth` DATE NULL,
  ADD COLUMN `date_of_birth_provided_at` DATETIME(6) NULL;
