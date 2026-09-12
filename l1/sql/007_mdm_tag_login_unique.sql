-- Login e-mail uniqueness across entities: one (namespace='login', tag, module) pair.
-- Alpha regenerates the schema from persistence.ts; this file documents the same index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mdm_tag_login_unique
  ON mdm_tag ("namespace", "tag", "module")
  WHERE "namespace" = 'login';
