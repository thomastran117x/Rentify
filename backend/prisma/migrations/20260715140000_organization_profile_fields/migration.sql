ALTER TABLE `organizations`
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `website_url` VARCHAR(500) NULL,
  ADD COLUMN `contact_email` VARCHAR(320) NULL,
  ADD COLUMN `contact_phone` VARCHAR(40) NULL,
  ADD COLUMN `address_line1` VARCHAR(200) NULL,
  ADD COLUMN `address_line2` VARCHAR(200) NULL,
  ADD COLUMN `city` VARCHAR(120) NULL,
  ADD COLUMN `region` VARCHAR(120) NULL,
  ADD COLUMN `country` VARCHAR(120) NULL,
  ADD COLUMN `postal_code` VARCHAR(20) NULL,
  ADD COLUMN `logo_url` VARCHAR(1024) NULL,
  ADD COLUMN `logo_blob_name` VARCHAR(1024) NULL,
  ADD COLUMN `custom_fields` JSON NULL;
