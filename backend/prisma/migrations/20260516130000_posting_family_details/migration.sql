ALTER TABLE `postings`
  ADD COLUMN `place_details` JSON NULL AFTER `tags`,
  ADD COLUMN `equipment_details` JSON NULL AFTER `place_details`,
  ADD COLUMN `vehicle_details` JSON NULL AFTER `equipment_details`;

UPDATE `postings`
SET
  `place_details` = CASE WHEN `family` = 'place' THEN `attributes` ELSE NULL END,
  `equipment_details` = CASE WHEN `family` = 'equipment' THEN `attributes` ELSE NULL END,
  `vehicle_details` = CASE WHEN `family` = 'vehicle' THEN `attributes` ELSE NULL END;

ALTER TABLE `postings`
  DROP COLUMN `attributes`;
