-- Index every column that stores an image reference.
--
-- The media cleanup and DELETE /media/{id} ask, by name, whether any stored
-- reference still points at an image, and without these indexes each question
-- scanned all four tables. The columns are VARCHAR(1024), longer than an
-- InnoDB key can hold in utf8mb4, so each index covers the first 255
-- characters; blob names are far shorter, so it still finds a single row.

-- CreateIndex
CREATE INDEX `organization_blog_posts_cover_image_blob_name_idx` ON `organization_blog_posts`(`cover_image_blob_name`(255));

-- CreateIndex
CREATE INDEX `organizations_logo_blob_name_idx` ON `organizations`(`logo_blob_name`(255));

-- CreateIndex
CREATE INDEX `posting_photos_blob_name_idx` ON `posting_photos`(`blob_name`(255));

-- CreateIndex
CREATE INDEX `posting_photos_thumbnail_blob_name_idx` ON `posting_photos`(`thumbnail_blob_name`(255));

-- CreateIndex
CREATE INDEX `profiles_avatar_blob_name_idx` ON `profiles`(`avatar_blob_name`(255));
