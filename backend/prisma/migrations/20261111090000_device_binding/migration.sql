-- Device binding.
--
-- binding_id is the id carried by the signed, httpOnly device cookie. A device
-- is known only when a request presents that cookie, so existing rows (all
-- NULL) stop counting as known until their browser signs in and verifies
-- again. The column is nullable and unread by the previous release, so an
-- instance still running it is unaffected.

-- AlterTable
ALTER TABLE `devices` ADD COLUMN `binding_id` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `devices_user_id_binding_id_key` ON `devices`(`user_id`, `binding_id`);
