CREATE TABLE IF NOT EXISTS mdm_audit_log (
  "id" TEXT PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "routine" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_audit_entity ON mdm_audit_log ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS idx_mdm_audit_actor ON mdm_audit_log ("actorId");
CREATE INDEX IF NOT EXISTS idx_mdm_audit_module_created ON mdm_audit_log ("module", "createdAt");

CREATE TABLE IF NOT EXISTS mdm_monitoring_write (
  "id" TEXT PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NULL,
  "module" TEXT NOT NULL,
  "routine" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "startedAt" TIMESTAMPTZ NOT NULL,
  "finishedAt" TIMESTAMPTZ NOT NULL,
  "actorType" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "errorCode" TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_monitoring_module_finished ON mdm_monitoring_write ("module", "finishedAt");
CREATE INDEX IF NOT EXISTS idx_mdm_monitoring_entity ON mdm_monitoring_write ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS idx_mdm_monitoring_success ON mdm_monitoring_write ("success", "finishedAt");

CREATE TABLE IF NOT EXISTS mdm_error_log (
  "id" TEXT PRIMARY KEY,
  "entityType" TEXT NULL,
  "entityId" TEXT NULL,
  "module" TEXT NOT NULL,
  "routine" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "errorCode" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "details" JSONB NULL,
  "stack" TEXT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_error_module_created ON mdm_error_log ("module", "createdAt");
CREATE INDEX IF NOT EXISTS idx_mdm_error_entity ON mdm_error_log ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS idx_mdm_error_code ON mdm_error_log ("errorCode", "createdAt");

CREATE TABLE IF NOT EXISTS mdm_status_history (
  "id" TEXT PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "fromStatus" TEXT NULL,
  "toStatus" TEXT NOT NULL,
  "reason" TEXT NULL,
  "reasonCode" TEXT NULL,
  "actorId" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "routine" TEXT NOT NULL,
  "metadata" JSONB NULL,
  "createdAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdm_status_entity ON mdm_status_history ("entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_mdm_status_transition ON mdm_status_history ("module", "fromStatus", "toStatus");
