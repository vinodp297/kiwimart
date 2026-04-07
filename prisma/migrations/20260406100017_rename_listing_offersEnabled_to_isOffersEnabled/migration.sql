-- Rename boolean: Listing.offersEnabled → isOffersEnabled
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'Listing'
      AND column_name = 'offersEnabled'
  ) THEN
    ALTER TABLE "Listing" RENAME COLUMN "offersEnabled" TO "isOffersEnabled";
  END IF;
END$$;
