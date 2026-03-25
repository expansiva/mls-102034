CREATE TABLE IF NOT EXISTS mdm_tag (
  "id" TEXT PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "namespace" TEXT NULL,
  "module" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdByType" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_tag_entity ON mdm_tag ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS idx_mdm_tag_lookup ON mdm_tag ("entityType", "tag", "module");
CREATE INDEX IF NOT EXISTS idx_mdm_tag_namespace ON mdm_tag ("entityType", "namespace", "module");
CREATE INDEX IF NOT EXISTS idx_mdm_tag_module_tag ON mdm_tag ("module", "tag");
CREATE UNIQUE INDEX IF NOT EXISTS idx_mdm_tag_unique ON mdm_tag ("entityType", "entityId", "tag", "module");
