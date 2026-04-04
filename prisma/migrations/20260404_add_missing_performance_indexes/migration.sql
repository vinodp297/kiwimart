-- Add 4 performance indexes missing from the post-sprint architecture audit.
-- All statements use IF NOT EXISTS for idempotency.

-- 1. Listing: expiry cron job filter
--    expireListings.ts queries status=ACTIVE + expiresAt<=now().
--    Without this, every expiry run does a full table scan on Listing.
CREATE INDEX IF NOT EXISTS "Listing_status_expiresAt_idx"
  ON "Listing" ("status", "expiresAt");

-- 2. Offer: payment deadline auto-release filter
--    Auto-release job queries status=ACCEPTED + paymentDeadline<=now().
--    Without this, the job scans the entire Offer table.
CREATE INDEX IF NOT EXISTS "Offer_status_paymentDeadline_idx"
  ON "Offer" ("status", "paymentDeadline");

-- 3. Notification: deduplication lookup
--    dispatchReminders.ts batches userId+orderId+type lookups to prevent
--    duplicate notifications. Without this, the IN query fan-outs are slow.
CREATE INDEX IF NOT EXISTS "Notification_userId_orderId_type_idx"
  ON "Notification" ("userId", "orderId", "type");

-- 4. ListingImage: r2Key lookup for image validation
--    Image validation queries filter by r2Key IN (...) to verify ownership.
--    Without this, every image safety check scans the full ListingImage table.
CREATE INDEX IF NOT EXISTS "ListingImage_r2Key_idx"
  ON "ListingImage" ("r2Key");
