-- Rename boolean: Category.active → isActive
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'Category'
      AND column_name = 'active'
  ) THEN
    ALTER TABLE "Category" RENAME COLUMN "active" TO "isActive";
  END IF;
END$$;
