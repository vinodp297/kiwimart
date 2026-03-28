-- Add CHECK constraints on money/rating fields to prevent invalid values.
-- Uses DO blocks for idempotency (safe to re-run).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'listing_price_positive'
  ) THEN
    ALTER TABLE "Listing" ADD CONSTRAINT "listing_price_positive" CHECK ("priceNzd" >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_amounts_positive'
  ) THEN
    ALTER TABLE "Order" ADD CONSTRAINT "order_amounts_positive"
      CHECK ("itemNzd" >= 0 AND "shippingNzd" >= 0 AND "totalNzd" >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payout_amounts_positive'
  ) THEN
    ALTER TABLE "Payout" ADD CONSTRAINT "payout_amounts_positive" CHECK ("amountNzd" >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cartitem_price_positive'
  ) THEN
    ALTER TABLE "CartItem" ADD CONSTRAINT "cartitem_price_positive" CHECK ("priceNzd" >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'review_rating_range'
  ) THEN
    ALTER TABLE "Review" ADD CONSTRAINT "review_rating_range" CHECK ("rating" >= 1 AND "rating" <= 50);
  END IF;
END $$;
