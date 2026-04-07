-- Rename boolean: User.stripePayoutsEnabled → isStripePayoutsEnabled
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'User'
      AND column_name = 'stripePayoutsEnabled'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "stripePayoutsEnabled" TO "isStripePayoutsEnabled";
  END IF;
END$$;
