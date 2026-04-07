-- Rename boolean: User.stripeOnboarded → isStripeOnboarded
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'User'
      AND column_name = 'stripeOnboarded'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "stripeOnboarded" TO "isStripeOnboarded";
  END IF;
END$$;
