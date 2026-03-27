-- Sprint: Cancellation logic + expanded dispute reasons
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.

-- ── Order cancellation columns ─────────────────────────────────────────────
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelledBy"   TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelReason"  TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelledAt"   TIMESTAMP(3);

-- ── Expand DisputeReason enum with new values ──────────────────────────────
-- PostgreSQL enums can be extended with ALTER TYPE ... ADD VALUE IF NOT EXISTS.
ALTER TYPE "DisputeReason" ADD VALUE IF NOT EXISTS 'WRONG_ITEM_SENT';
ALTER TYPE "DisputeReason" ADD VALUE IF NOT EXISTS 'COUNTERFEIT_ITEM';
ALTER TYPE "DisputeReason" ADD VALUE IF NOT EXISTS 'SELLER_CANCELLED';
ALTER TYPE "DisputeReason" ADD VALUE IF NOT EXISTS 'REFUND_NOT_PROCESSED';

-- ── Index for cancellation queries ─────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Order_cancelledAt_idx') THEN
    CREATE INDEX "Order_cancelledAt_idx" ON "Order" ("cancelledAt");
  END IF;
END $$;
