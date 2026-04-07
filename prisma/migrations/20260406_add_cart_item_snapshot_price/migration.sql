-- AlterTable: add snapshotPriceNzd to CartItem
-- Immutable listing price snapshot captured at cart-add time (NZD cents).
-- Backfill existing rows using priceNzd (the existing add-time snapshot).
-- Idempotent: guarded by IF NOT EXISTS / column existence checks.

DO $$BEGIN
  -- Step 1: Add column as nullable to allow backfill (skip if already exists)
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CartItem' AND column_name = 'snapshotPriceNzd'
  ) THEN
    ALTER TABLE "CartItem" ADD COLUMN "snapshotPriceNzd" INTEGER;

    -- Step 2: Backfill existing rows
    UPDATE "CartItem" SET "snapshotPriceNzd" = "priceNzd" WHERE "snapshotPriceNzd" IS NULL;

    -- Step 3: Make the column NOT NULL now that all rows have a value
    ALTER TABLE "CartItem" ALTER COLUMN "snapshotPriceNzd" SET NOT NULL;
  END IF;
END$$;
