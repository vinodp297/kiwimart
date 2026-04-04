-- Add performance indexes identified during architecture refactor.
-- All statements use IF NOT EXISTS for idempotency.

-- 1. Partial index: active listings only
--    Covers every public browse/search query (status=ACTIVE, deletedAt=null).
--    Eliminates sold/draft/expired rows from the index entirely.
CREATE INDEX IF NOT EXISTS "Listing_active_partial_idx"
  ON "Listing" ("createdAt" DESC, "categoryId", "region", "priceNzd")
  WHERE status = 'ACTIVE' AND "deletedAt" IS NULL;

-- 2. WatchlistItem: price drop notification job filter
--    priceDropNotifications.ts queries listingId + priceAlertEnabled=true.
CREATE INDEX IF NOT EXISTS "WatchlistItem_listingId_priceAlertEnabled_idx"
  ON "WatchlistItem" ("listingId", "priceAlertEnabled")
  WHERE "priceAlertEnabled" = true;

-- 3. Order: stripe reconciliation date-range filter
--    stripeReconciliation.ts queries status=PAYMENT_HELD + createdAt>=since.
CREATE INDEX IF NOT EXISTS "Order_status_createdAt_idx"
  ON "Order" ("status", "createdAt" DESC);

-- 4. TrustMetrics: seller downgrade check dispute rate filter
--    sellerDowngradeCheck.ts filters disputeRate > threshold across all sellers.
CREATE INDEX IF NOT EXISTS "TrustMetrics_disputeRate_idx"
  ON "TrustMetrics" ("disputeRate");

-- 5. Notification: cursor-paginated queries ordered by createdAt DESC
--    Optimises /api/v1/notifications cursor pagination for each user.
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_desc_idx"
  ON "Notification" ("userId", "createdAt" DESC);
