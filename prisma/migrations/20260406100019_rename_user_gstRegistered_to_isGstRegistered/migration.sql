-- Rename boolean: User.gstRegistered → isGstRegistered
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'User'
      AND column_name = 'gstRegistered'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "gstRegistered" TO "isGstRegistered";
  END IF;
END$$;
