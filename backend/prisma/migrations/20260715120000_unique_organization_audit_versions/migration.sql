CREATE UNIQUE INDEX `organization_audit_logs_org_version_unique`
  ON `organization_audit_logs`(`organization_id`, `organization_version`);

CREATE UNIQUE INDEX `org_audit_resource_version_unique`
  ON `organization_audit_logs`(
    `organization_id`,
    `resource_type`,
    `resource_id`,
    `resource_version`
  );
