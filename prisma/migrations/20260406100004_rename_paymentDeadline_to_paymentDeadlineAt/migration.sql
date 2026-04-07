-- Rename timestamp: Offer.paymentDeadline → paymentDeadlineAt
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'Offer'
      AND column_name = 'paymentDeadline'
  ) THEN
    ALTER TABLE "Offer" RENAME COLUMN "paymentDeadline" TO "paymentDeadlineAt";
  END IF;
END$$;
