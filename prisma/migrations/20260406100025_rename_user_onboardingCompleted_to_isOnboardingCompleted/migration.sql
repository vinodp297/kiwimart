-- Rename boolean: User.onboardingCompleted → isOnboardingCompleted
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'User'
      AND column_name = 'onboardingCompleted'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "onboardingCompleted" TO "isOnboardingCompleted";
  END IF;
END$$;
