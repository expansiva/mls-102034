CREATE TABLE IF NOT EXISTS _schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mdm_entity_index (
  "mdmId" TEXT PRIMARY KEY,
  "subtype" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "docType" TEXT NULL,
  "docId" TEXT NULL,
  "countryCode" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT '{}',
  "searchVector" TEXT NOT NULL,
  "mergedInto" TEXT NULL,
  "dynamoPk" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_entity_subtype ON mdm_entity_index ("subtype");
CREATE INDEX IF NOT EXISTS idx_mdm_entity_name ON mdm_entity_index ("name");
CREATE INDEX IF NOT EXISTS idx_mdm_entity_status ON mdm_entity_index ("status");
CREATE INDEX IF NOT EXISTS idx_mdm_entity_doctype ON mdm_entity_index ("docType");
CREATE INDEX IF NOT EXISTS idx_mdm_entity_docid ON mdm_entity_index ("docId");
CREATE INDEX IF NOT EXISTS idx_mdm_entity_country ON mdm_entity_index ("countryCode");
CREATE INDEX IF NOT EXISTS idx_mdm_entity_dynamopk ON mdm_entity_index ("dynamoPk");
CREATE INDEX IF NOT EXISTS idx_mdm_entity_createdat ON mdm_entity_index ("createdAt");
CREATE INDEX IF NOT EXISTS idx_mdm_entity_updatedat ON mdm_entity_index ("updatedAt");

CREATE TABLE IF NOT EXISTS mdm_prospect_index (
  "mdmId" TEXT PRIMARY KEY,
  "subtype" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "docType" TEXT NULL,
  "docId" TEXT NULL,
  "countryCode" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT '{}',
  "promotionSource" TEXT NOT NULL,
  "promotedTo" TEXT NULL,
  "ttlExpiresAt" TIMESTAMPTZ NULL,
  "dynamoPk" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_prospect_subtype ON mdm_prospect_index ("subtype");
CREATE INDEX IF NOT EXISTS idx_mdm_prospect_status ON mdm_prospect_index ("status");
CREATE INDEX IF NOT EXISTS idx_mdm_prospect_docid ON mdm_prospect_index ("docId");
CREATE INDEX IF NOT EXISTS idx_mdm_prospect_country ON mdm_prospect_index ("countryCode");

CREATE TABLE IF NOT EXISTS mdm_relationship (
  "id" TEXT PRIMARY KEY,
  "fromId" TEXT NOT NULL,
  "toId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "role" TEXT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "isBidirectional" BOOLEAN NOT NULL,
  "validFrom" DATE NOT NULL,
  "validTo" DATE NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_relationship_fromid ON mdm_relationship ("fromId");
CREATE INDEX IF NOT EXISTS idx_mdm_relationship_toid ON mdm_relationship ("toId");
CREATE INDEX IF NOT EXISTS idx_mdm_relationship_type ON mdm_relationship ("type");
CREATE INDEX IF NOT EXISTS idx_mdm_relationship_status ON mdm_relationship ("status");

CREATE TABLE IF NOT EXISTS mdm_prospect_relationship (
  "id" TEXT PRIMARY KEY,
  "fromId" TEXT NOT NULL,
  "toId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "role" TEXT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "isBidirectional" BOOLEAN NOT NULL,
  "validFrom" DATE NOT NULL,
  "validTo" DATE NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_prospect_relationship_fromid ON mdm_prospect_relationship ("fromId");
CREATE INDEX IF NOT EXISTS idx_mdm_prospect_relationship_toid ON mdm_prospect_relationship ("toId");

CREATE UNLOGGED TABLE IF NOT EXISTS mdm_cache (
  "mdmId" TEXT PRIMARY KEY,
  "version" INTEGER NOT NULL,
  "details" JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS mdm_outbox (
  "id" TEXT PRIMARY KEY,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "processedAt" TIMESTAMPTZ NULL,
  "lastError" TEXT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "topic" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_outbox_topic ON mdm_outbox ("topic");
CREATE INDEX IF NOT EXISTS idx_mdm_outbox_processed ON mdm_outbox ("processedAt");

CREATE TABLE IF NOT EXISTS mdm_replication_failures (
  "id" TEXT PRIMARY KEY,
  "outboxId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "errorMessage" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL
);
