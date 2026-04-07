-- Rename boolean: User.mfaEnabled → isMfaEnabled
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'User'
      AND column_name = 'mfaEnabled'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "mfaEnabled" TO "isMfaEnabled";
  END IF;
END$$;
