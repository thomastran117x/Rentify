-- Record the smaller renditions of a processed image.
--
-- The media processing worker now writes a medium (800 px) and a thumbnail
-- (300 px) rendition beside the processed image, named from it, so a small
-- surface need not download the full image. Nothing references them by name:
-- they follow the processed blob wherever it is stored.
--
-- `variants` describes the renditions as written, for example
-- `{"medium": {"width", "height", "sizeBytes"}, "thumbnail": {...}}`. It is
-- set together with `status = 'ready'`, and stays NULL for images processed
-- before renditions existed. The media-variants backfill selects those rows,
-- writes their renditions, and sets it, so NULL on a ready row means "not yet
-- backfilled".

-- AlterTable
ALTER TABLE `media` ADD COLUMN `variants` JSON NULL;
