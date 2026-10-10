-- Record the image names a restorable audit entry holds.
--
-- Restoring an organization or posting audit entry writes its logo or photos
-- back, so the media cleanup must keep every image such an entry names. It
-- used to find them by evaluating JSON paths over every restorable entry on
-- each sweep, a cost that grew with the audit log. AuditRepository.create now
-- writes one row per held name, beside the entry and in the same transaction,
-- and the cleanup looks names up by index. Restorable entries never stop being
-- restorable, and the rows go with their entry.

-- CreateTable
CREATE TABLE `organization_audit_blob_references` (
    `id` VARCHAR(36) NOT NULL,
    `audit_log_id` VARCHAR(36) NOT NULL,
    `blob_name` VARCHAR(1024) NOT NULL,

    INDEX `organization_audit_blob_references_audit_log_id_idx`(`audit_log_id`),
    INDEX `organization_audit_blob_references_blob_name_idx`(`blob_name`(255)),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `organization_audit_blob_references` ADD CONSTRAINT `organization_audit_blob_references_audit_log_id_fkey` FOREIGN KEY (`audit_log_id`) REFERENCES `organization_audit_logs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the entries written before this migration. This is a one-time copy,
-- in SQL, of listAuditSnapshotBlobNames in features/organizations/audit/
-- audit.model.ts: an organization entry holds its logo, and a posting entry
-- each photo and photo crop, from its before and after snapshots, trimmed,
-- with blank and non-string values left out. A test runs this statement and
-- compares its rows with that function.
INSERT INTO `organization_audit_blob_references` (`id`, `audit_log_id`, `blob_name`)
SELECT UUID(), held.audit_log_id, held.blob_name
FROM (
    SELECT a.id AS audit_log_id, TRIM(JSON_UNQUOTE(names.value)) AS blob_name
    FROM `organization_audit_logs` a,
        JSON_TABLE(
            JSON_ARRAY(
                JSON_EXTRACT(a.before_snapshot, '$.logoBlobName'),
                JSON_EXTRACT(a.after_snapshot, '$.logoBlobName')
            ),
            '$[*]' COLUMNS (value JSON PATH '$')
        ) names
    WHERE a.restorable = TRUE
        AND a.resource_type = 'organization'
        AND JSON_TYPE(names.value) = 'STRING'
    UNION
    SELECT photos.audit_log_id, TRIM(JSON_UNQUOTE(photos.value))
    FROM (
        SELECT a.id AS audit_log_id, names.blob_name AS value
        FROM `organization_audit_logs` a,
            JSON_TABLE(
                JSON_MERGE_PRESERVE(
                    IF(JSON_TYPE(JSON_EXTRACT(a.before_snapshot, '$.photos')) = 'ARRAY', JSON_EXTRACT(a.before_snapshot, '$.photos'), JSON_ARRAY()),
                    IF(JSON_TYPE(JSON_EXTRACT(a.after_snapshot, '$.photos')) = 'ARRAY', JSON_EXTRACT(a.after_snapshot, '$.photos'), JSON_ARRAY())
                ),
                '$[*]' COLUMNS (
                    blob_name JSON PATH '$.blobName',
                    thumbnail_blob_name JSON PATH '$.thumbnailBlobName'
                )
            ) names
        WHERE a.restorable = TRUE AND a.resource_type = 'posting'
        UNION ALL
        SELECT a.id, names.thumbnail_blob_name
        FROM `organization_audit_logs` a,
            JSON_TABLE(
                JSON_MERGE_PRESERVE(
                    IF(JSON_TYPE(JSON_EXTRACT(a.before_snapshot, '$.photos')) = 'ARRAY', JSON_EXTRACT(a.before_snapshot, '$.photos'), JSON_ARRAY()),
                    IF(JSON_TYPE(JSON_EXTRACT(a.after_snapshot, '$.photos')) = 'ARRAY', JSON_EXTRACT(a.after_snapshot, '$.photos'), JSON_ARRAY())
                ),
                '$[*]' COLUMNS (
                    blob_name JSON PATH '$.blobName',
                    thumbnail_blob_name JSON PATH '$.thumbnailBlobName'
                )
            ) names
        WHERE a.restorable = TRUE AND a.resource_type = 'posting'
    ) photos
    WHERE JSON_TYPE(photos.value) = 'STRING'
) held
WHERE held.blob_name <> '';
