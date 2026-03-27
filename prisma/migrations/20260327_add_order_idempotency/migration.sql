-- Migration: add_order_idempotency
-- Adds idempotencyKey field to the Order table.
-- This field is set by the client checkout session (useRef) to prevent
-- duplicate orders from double-clicks or retried form submissions.

ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
