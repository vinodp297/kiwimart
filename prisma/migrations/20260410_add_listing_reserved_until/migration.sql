-- Fix 10: Add reservedUntil to Listing for stale-reservation reconciliation.
-- A listing flipped to RESERVED at checkout records a deadline by which the
-- payment must be confirmed. The release-stale-reservations cron returns
-- expired reservations to ACTIVE so the inventory is not stuck.

ALTER TABLE "Listing" ADD COLUMN "reservedUntil" TIMESTAMP(3);

-- Composite index lets the cron scan only RESERVED listings whose
-- reservedUntil has elapsed, which is the only access pattern for this column.
CREATE INDEX "Listing_status_reservedUntil_idx"
  ON "Listing"("status", "reservedUntil");
