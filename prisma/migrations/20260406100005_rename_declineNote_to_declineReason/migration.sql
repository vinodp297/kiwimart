-- Rename field: Offer.declineNote → declineReason
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'Offer'
      AND column_name = 'declineNote'
  ) THEN
    ALTER TABLE "Offer" RENAME COLUMN "declineNote" TO "declineReason";
  END IF;
END$$;
