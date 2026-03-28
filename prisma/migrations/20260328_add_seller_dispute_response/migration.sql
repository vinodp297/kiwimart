-- Seller dispute response fields + audit action
-- Safe to re-run: all statements use IF NOT EXISTS guards.

-- ── Seller response columns on Order ─────────────────────────────────────────
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sellerResponse"    TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sellerRespondedAt" TIMESTAMP(3);

-- ── Expand AuditAction enum ──────────────────────────────────────────────────
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DISPUTE_SELLER_RESPONDED';
