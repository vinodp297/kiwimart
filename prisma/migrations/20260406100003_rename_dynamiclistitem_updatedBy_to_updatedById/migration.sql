-- Rename FK column: DynamicListItem.updatedBy → updatedById
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'DynamicListItem'
      AND column_name = 'updatedBy'
  ) THEN
    ALTER TABLE "DynamicListItem" RENAME COLUMN "updatedBy" TO "updatedById";
  END IF;
END$$;
