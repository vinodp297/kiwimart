-- Rename boolean: ListingImage.safe → isSafe
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'ListingImage'
      AND column_name = 'safe'
  ) THEN
    ALTER TABLE "ListingImage" RENAME COLUMN "safe" TO "isSafe";
  END IF;
END$$;
