CREATE TABLE IF NOT EXISTS mdm_comment (
  "id" TEXT PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "parentCommentId" TEXT NULL,
  "text" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "authorType" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "isSystemGenerated" BOOLEAN NOT NULL,
  "editedAt" TIMESTAMPTZ NULL,
  "deletedAt" TIMESTAMPTZ NULL,
  "createdAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_comment_entity_created ON mdm_comment ("entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_mdm_comment_parent ON mdm_comment ("parentCommentId");
CREATE INDEX IF NOT EXISTS idx_mdm_comment_author_created ON mdm_comment ("authorId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_mdm_comment_module_created ON mdm_comment ("module", "createdAt");

CREATE TABLE IF NOT EXISTS mdm_attachment (
  "id" TEXT PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "category" TEXT NULL,
  "uploadedBy" TEXT NOT NULL,
  "uploadedAt" TIMESTAMPTZ NOT NULL,
  "deletedAt" TIMESTAMPTZ NULL,
  "details" JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_attachment_entity ON mdm_attachment ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS idx_mdm_attachment_entity_category ON mdm_attachment ("entityType", "entityId", "category");
CREATE INDEX IF NOT EXISTS idx_mdm_attachment_uploaded ON mdm_attachment ("uploadedBy", "uploadedAt");
CREATE INDEX IF NOT EXISTS idx_mdm_attachment_deleted ON mdm_attachment ("deletedAt");

CREATE TABLE IF NOT EXISTS mdm_number_sequence (
  "id" TEXT PRIMARY KEY,
  "sequenceKey" TEXT NOT NULL,
  "prefix" TEXT NULL,
  "currentValue" INTEGER NOT NULL,
  "increment" INTEGER NOT NULL,
  "padding" INTEGER NULL,
  "yearSegment" BOOLEAN NOT NULL,
  "scopeType" TEXT NOT NULL,
  "scopeId" TEXT NULL,
  "lastIssuedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "details" JSONB NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mdm_number_sequence_key ON mdm_number_sequence ("sequenceKey");
CREATE INDEX IF NOT EXISTS idx_mdm_number_sequence_scope ON mdm_number_sequence ("scopeType", "scopeId");
