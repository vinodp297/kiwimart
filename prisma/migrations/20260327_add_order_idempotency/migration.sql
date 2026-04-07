-- Migration: add_order_idempotency
-- Adds idempotencyKey field to the Order table.
-- This field is set by the client checkout session (useRef) to prevent
-- duplicate orders from double-clicks or retried form submissions.
-- Idempotent: uses IF NOT EXISTS guards.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
