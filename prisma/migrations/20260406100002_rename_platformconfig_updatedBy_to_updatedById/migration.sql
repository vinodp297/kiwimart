-- Rename FK column: PlatformConfig.updatedBy → updatedById
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'PlatformConfig'
      AND column_name = 'updatedBy'
  ) THEN
    ALTER TABLE "PlatformConfig" RENAME COLUMN "updatedBy" TO "updatedById";
  END IF;
END$$;
