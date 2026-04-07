-- Rename boolean: Listing.gstIncluded → isGstIncluded
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'Listing'
      AND column_name = 'gstIncluded'
  ) THEN
    ALTER TABLE "Listing" RENAME COLUMN "gstIncluded" TO "isGstIncluded";
  END IF;
END$$;
