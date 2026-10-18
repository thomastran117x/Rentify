-- Index auth_audit_events by created_at alone.
--
-- The auth audit prune worker deletes rows older than the retention period:
-- `WHERE created_at < ? ORDER BY created_at LIMIT n`. Every existing index puts
-- another column ahead of created_at, so none of them can serve that range
-- and each batch would scan the table. InnoDB builds a secondary index online,
-- so writes to the table continue while it is created. The change is additive;
-- an instance still running the previous release is unaffected.

-- CreateIndex
CREATE INDEX `auth_audit_events_created_at_idx` ON `auth_audit_events`(`created_at`);
