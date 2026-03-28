-- Add composite indexes for common query patterns.
-- Uses IF NOT EXISTS for idempotency.

-- ListingImage: ordered images per listing
CREATE INDEX IF NOT EXISTS "ListingImage_listingId_order_idx"
  ON "ListingImage" ("listingId", "order");

-- Listing: seller's listings sorted by recency
CREATE INDEX IF NOT EXISTS "Listing_sellerId_createdAt_idx"
  ON "Listing" ("sellerId", "createdAt" DESC);

-- Order: seller order queries by status (tier calculation, dashboard)
CREATE INDEX IF NOT EXISTS "Order_sellerId_status_idx"
  ON "Order" ("sellerId", "status");

-- Order: recent completed sales for tier calculation
CREATE INDEX IF NOT EXISTS "Order_sellerId_completedAt_idx"
  ON "Order" ("sellerId", "completedAt");
