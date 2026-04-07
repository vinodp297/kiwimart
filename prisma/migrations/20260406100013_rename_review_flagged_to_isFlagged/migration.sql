-- Rename boolean: Review.flagged → isFlagged
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'Review'
      AND column_name = 'flagged'
  ) THEN
    ALTER TABLE "Review" RENAME COLUMN "flagged" TO "isFlagged";
  END IF;
END$$;
