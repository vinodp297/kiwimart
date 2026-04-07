-- Rename boolean: ListingImage.scanned → isScanned
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'ListingImage'
      AND column_name = 'scanned'
  ) THEN
    ALTER TABLE "ListingImage" RENAME COLUMN "scanned" TO "isScanned";
  END IF;
END$$;
