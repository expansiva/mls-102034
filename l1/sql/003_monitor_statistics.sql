CREATE TABLE IF NOT EXISTS monitor_bff_execution_log (
  "id" TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "traceId" TEXT NOT NULL,
  "routine" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "pageName" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "statusGroup" TEXT NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "errorCode" TEXT NULL,
  "startedAt" TIMESTAMPTZ NOT NULL,
  "finishedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitor_bff_log_routine ON monitor_bff_execution_log ("routine");
CREATE INDEX IF NOT EXISTS idx_monitor_bff_log_module ON monitor_bff_execution_log ("module");
CREATE INDEX IF NOT EXISTS idx_monitor_bff_log_page ON monitor_bff_execution_log ("pageName");
CREATE INDEX IF NOT EXISTS idx_monitor_bff_log_status_code ON monitor_bff_execution_log ("statusCode");
CREATE INDEX IF NOT EXISTS idx_monitor_bff_log_status_group ON monitor_bff_execution_log ("statusGroup");
CREATE INDEX IF NOT EXISTS idx_monitor_bff_log_finished_at ON monitor_bff_execution_log ("finishedAt");

CREATE TABLE IF NOT EXISTS monitor_bff_execution_agg_minute (
  "id" TEXT PRIMARY KEY,
  "bucketStart" TIMESTAMPTZ NOT NULL,
  "routine" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "pageName" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "statusGroup" TEXT NOT NULL,
  "totalCount" INTEGER NOT NULL,
  "successCount" INTEGER NOT NULL,
  "clientErrorCount" INTEGER NOT NULL,
  "serverErrorCount" INTEGER NOT NULL,
  "notFoundCount" INTEGER NOT NULL,
  "totalDurationMs" INTEGER NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitor_bff_agg_bucket ON monitor_bff_execution_agg_minute ("bucketStart");
CREATE INDEX IF NOT EXISTS idx_monitor_bff_agg_routine ON monitor_bff_execution_agg_minute ("routine");
CREATE INDEX IF NOT EXISTS idx_monitor_bff_agg_status_group ON monitor_bff_execution_agg_minute ("statusGroup");
