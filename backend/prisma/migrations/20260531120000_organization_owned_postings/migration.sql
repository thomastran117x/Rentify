ALTER TABLE `postings`
  ADD COLUMN `organization_id` VARCHAR(36) NULL;

UPDATE `postings` `p`
INNER JOIN `organization_memberships` `membership`
  ON `membership`.`user_id` = `p`.`owner_id`
  AND `membership`.`role` = 'primary_manager'
SET `p`.`organization_id` = `membership`.`organization_id`
WHERE `p`.`organization_id` IS NULL;

ALTER TABLE `postings`
  MODIFY `organization_id` VARCHAR(36) NOT NULL,
  ADD INDEX `postings_organization_id_status_idx`(`organization_id`, `status`),
  ADD CONSTRAINT `postings_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
