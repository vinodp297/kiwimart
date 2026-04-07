-- Rename boolean: WatchlistItem.priceAlertEnabled → isPriceAlertEnabled
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'WatchlistItem'
      AND column_name = 'priceAlertEnabled'
  ) THEN
    ALTER TABLE "WatchlistItem" RENAME COLUMN "priceAlertEnabled" TO "isPriceAlertEnabled";
  END IF;
END$$;
