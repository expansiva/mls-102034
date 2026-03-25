DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mdm_cache'
      AND column_name = 'details'
      AND data_type <> 'jsonb'
  ) THEN
    ALTER TABLE mdm_cache
      ALTER COLUMN "details" TYPE JSONB
      USING CASE
        WHEN "details" IS NULL THEN '{}'::jsonb
        ELSE "details"::jsonb
      END;
  END IF;
END $$;
